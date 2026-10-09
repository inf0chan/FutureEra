"""Checks the group chat page: the message store, the image rules, and the gate.

A chat is the first thing on this site that puts something a visitor typed into
storage, and the first thing that accepts a file. Those are the two places worth
a test, so this checks them rather than the layout.

    Backend\\.venv\\Scripts\\python.exe check_chat.py
"""

import json
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
ROOT = BACKEND.parent
FRONTEND = ROOT / "Frontend"

js = (FRONTEND / "script.js").read_text(encoding="utf-8")
css = (FRONTEND / "style.css").read_text(encoding="utf-8")
groups_page = (FRONTEND / "group.html").read_text(encoding="utf-8")
people = json.loads((BACKEND / "data" / "people.json").read_text(encoding="utf-8"))

errs: list[str] = []


def slice_function(source: str, name: str) -> str:
    """Body of `function name(...)`, found by balancing braces."""
    m = re.search(rf"function\s+{re.escape(name)}\s*\(", source)
    if not m:
        return ""
    open_brace = source.find("{", m.end() - 1)
    depth = 0
    for i in range(open_brace, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[open_brace : i + 1]
    return ""


chat = slice_function(js, "initGroupChat")
if not chat:
    print("initGroupChat() is missing from script.js")
    sys.exit(1)

# comments explain the choices and quote hooks that are not real calls, so they
# come out before anything is asserted
code = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
code = re.sub(r"^\s*//.*$", "", code, flags=re.M)
chat_code = re.sub(r"/\*.*?\*/", "", chat, flags=re.S)

# ---------- the page ----------
if not (FRONTEND / "group.html").exists():
    print("group.html is missing from Frontend")
    sys.exit(1)

# A chat window opens with nothing but ?g=<id>, so every id the script reads has
# to be declared here or the page is a blank column.
chat_ids = sorted(set(re.findall(r'getElementById\("([\w-]+)"\)', chat_code)))
missing = [i for i in chat_ids if f'id="{i}"' not in groups_page]
if missing:
    errs.append(f"group.html is missing: {', '.join(missing)}")

# ---------- registered, or it silently never runs ----------
init_body = slice_function(js, "init")
if 'step("groupChat", initGroupChat)' not in init_body:
    errs.append("initGroupChat is never called from init()")

# ---------- opening in a new tab ----------
# A real link, not window.open: a link can be middle-clicked, copied, and is
# never a popup blocker, and rel=noopener keeps the tab from reaching back
# through window.opener into the page that opened it.
#
# Read from the comment-stripped source, not from js. Asserting against the raw
# file let a paragraph of prose explaining the noopener decision satisfy the
# check on its own: the string was in the comment, and the attribute was gone.
if 'href="group.html?g=' not in code:
    errs.append("no link to group.html?g= on the group cards, so there is nothing to click")
if 'rel="noopener"' not in code:
    errs.append("the chat link has no rel=noopener, so the new tab can reach window.opener")
if 'target="_blank"' not in code:
    errs.append("the chat link does not open in its own tab")
if "group.html?g=" in groups_page:
    errs.append("group.html links to itself")

# the id goes through the query string, so it must be encoded rather than pasted
if "encodeURIComponent(g.id)" not in code:
    errs.append("the chat link does not encode the group id")

# ---------- the id is validated, not trusted ----------
# It arrives in the query string. An unrecognised one has no label and no
# members, and messages written against it would be a room nothing can explain.
if 'new URLSearchParams(window.location.search).get("g")' not in chat_code:
    errs.append("initGroupChat does not read the group id from the query string")
if 'fetch("/api/groups")' not in chat_code:
    errs.append("initGroupChat does not fetch the registry, so the id cannot be checked against it")
if not re.search(r"if\s*\(\s*!wanted\s*\|\|\s*!row\s*\)", chat_code):
    errs.append("an unrecognised group id is not rejected before the page uses it")

# ---------- messages and images go to IndexedDB, not localStorage ----------
# The reason is capacity, not taste: a phone photo is 1-3MB as a data URL and
# localStorage has about 5MB for the whole origin.
if "indexedDB" not in js:
    errs.append("the chat does not use IndexedDB")
if not re.search(r"indexedDB\.open\(\s*CHAT_DB_NAME", code):
    errs.append("no IndexedDB database is opened")
for store in ("messages", "images"):
    if f'createObjectStore("{store}"' not in code:
        errs.append(f'no "{store}" object store is created')

# localStorage is still correct for the account and the membership - those are
# the readStore/writeStore helpers and they predate this. What must not be in it
# is a message or an image, so the assertion is scoped to the chat's own storage
# helpers rather than to the whole file.
store_fns = "".join(
    slice_function(js, fn)
    for fn in ("chatOpenDb", "chatStoreMessage", "chatListMessages", "chatGetImage")
)
if re.search(r"localStorage\.(setItem|getItem)", store_fns):
    errs.append("a message or image is written to localStorage, which is the store this moved away from")

# The store helpers are module-level, so they are checked where they are rather
# than through initGroupChat: asserting on a function's body instead of on the
# whole file is what keeps these from passing on someone else's code.
store_fn = re.sub(r"/\*.*?\*/", "", slice_function(js, "chatStoreMessage"), flags=re.S)
open_fn = re.sub(r"/\*.*?\*/", "", slice_function(js, "chatOpenDb"), flags=re.S)
prep_fn = re.sub(r"/\*.*?\*/", "", slice_function(js, "chatPrepareImage"), flags=re.S)

if not store_fn:
    errs.append("chatStoreMessage() is missing from script.js")
else:
    # a message and its image must land together, or the log shows a broken box
    if '"messages", "images"' not in store_fn or 'db.transaction(stores, "readwrite")' not in store_fn:
        errs.append("the message and its image are not written in one transaction")
    if "onabort" not in store_fn or "onerror" not in store_fn:
        errs.append("a failed or aborted store is not handled, so a full disk looks like a sent message")

if open_fn and ("onerror" not in open_fn or "onblocked" not in open_fn):
    errs.append("a failed or blocked database open is not handled")

# ---------- image type safety ----------
# The allowlist must be exactly the four formats with a signature we check, and
# must not contain SVG: an SVG can carry script, and a blob URL of one is
# same-origin content.
if not re.search(r"const\s+CHAT_IMAGE_TYPES\s*=\s*\{", js):
    errs.append("there is no image type allowlist")
for mime in ("image/jpeg", "image/png", "image/gif", "image/webp"):
    if f'"{mime}": true' not in js:
        errs.append(f"{mime} is not on the image allowlist")
if "image/svg" in js:
    errs.append("SVG is allowed as a chat image, and it can carry script")

# the type is decided by the bytes, not by what the browser reported
if "chatSniffImage" not in js:
    errs.append("the image type is never checked against the file's own bytes")
if "file.slice(0, 12).arrayBuffer()" not in code:
    errs.append("the image header is not read, so the declared type is trusted")
for sig in ("0xff, 0xd8, 0xff", "0x89, 0x50, 0x4e, 0x47", '"GIF87a"', '"RIFF"'):
    if sig not in code:
        errs.append(f"the magic-byte check is missing {sig}")

# a huge photo has to be shrunk, or the first message fills the disk
if "CHAT_MAX_EDGE" not in js or not prep_fn:
    errs.append("attached images are never resized")
if "createImageBitmap" not in js:
    errs.append("no decoder for the attached image, so nothing can be resized")
if "toBlob" not in code:
    errs.append("the resized image is never re-encoded")

# ---------- a GIF is not silently turned into a still ----------
if prep_fn:
    if "image/gif" not in prep_fn:
        errs.append("a GIF would be re-encoded like a photo, which discards the animation")
    if "CHAT_MAX_BYTES" not in prep_fn or "over the" not in prep_fn:
        errs.append("an over-sized GIF is not refused with an explanation")

# ---------- posting is for members ----------
# Checked twice on purpose: once to decide whether to show the composer, and
# again at send time, because membership can be removed in another tab and a
# page opened ten minutes ago is not evidence of anything.
if chat_code.count("myGroups()") < 2:
    errs.append("membership is not checked again at send time")
if "setMyGroups(" not in chat_code:
    errs.append("the chat page cannot join the group it is for, so a non-member has no way in")
if 'dispatchEvent(new CustomEvent("future-era:open-auth"))' not in chat_code:
    errs.append("posting while signed out does not ask for an account")

# ---------- what the user typed is escaped ----------
# The one thing in this feature that must never be interpolated raw.
for match in re.finditer(r"""['"]<[a-z][^'"]*\+[^'"]*\+""", chat_code):
    line = chat_code[: match.start()].count("\n") + 1
    seg = match.group(0)
    # esc() around a variable is fine; a bare + someVar + is not
    if "esc(" not in seg and re.search(r"\+\s*(m|row|who|rec|image|file|groupId)\b", seg):
        errs.append(f"unescaped value interpolated into markup near initGroupChat line {line}")
if 'esc(m.text)' not in chat_code:
    errs.append("message text is not escaped when rendered")
if "innerHTML" in chat_code and "esc(" not in chat_code:
    errs.append("the log is built with innerHTML but nothing is escaped")

# ---------- object URLs are released ----------
# One per image pins its blob in memory for the life of the document, so a
# repaint that does not revoke the old ones leaks the whole history.
if "URL.revokeObjectURL" not in chat_code:
    errs.append("object URLs are never revoked, so every repaint leaks the images it showed")
if "releaseLogUrls" not in chat_code:
    errs.append("there is no repaint-time cleanup of the log's object URLs")
if "pagehide" not in chat_code:
    errs.append("the page does not clean up its object URLs on the way out")

# ---------- a failed write must not look like a success ----------
if "it has not been sent" not in chat_code:
    errs.append("a failed send does not say the message was not sent")

# ---------- the log is scrollable, and only the log ----------
if not re.search(r"\.chat\s*\{[^}]*height:\s*100svh", css):
    errs.append(".chat is not a fixed-height column, so the log and the composer both scroll")
if not re.search(r"\.chat__log\s*\{[^}]*min-height:\s*0", css):
    errs.append(".chat__log has no min-height: 0, so a long history pushes the composer off screen")
if not re.search(r"\.chat__log\s*\{[^}]*overflow-y:\s*auto", css):
    errs.append(".chat__log does not scroll")

# ---------- the three [hidden] toggles need the display:none override ----------
# A flex element ignores the UA rule for [hidden], so the composer, the gate
# and the attachment preview would never hide without these.
for sel, name in (("chat__gate", "the sign-in / join gate"),
                  ("chat__composer", "the composer"),
                  ("chat__preview", "the attachment preview")):
    if f".{sel}[hidden]" not in css:
        errs.append(f".{sel}[hidden] is not in the display:none override, so {name} cannot be hidden")

# ---------- a real <form>, a real label, a real file input ----------
if '<form class="chat__composer" id="chat-form"' not in groups_page:
    errs.append("the composer is not a <form>, so Enter will not submit it")
if 'for="chat-file"' not in groups_page or 'id="chat-file"' not in groups_page:
    errs.append("the file input has no <label for>, so it cannot be opened without a pointer")
if 'type="file"' not in groups_page:
    errs.append("there is no file input, so images cannot be attached")
if 'accept="image/png,image/jpeg,image/gif,image/webp"' not in groups_page:
    errs.append("the file input does not even hint at the four allowed types")
if "aria-live" not in groups_page:
    errs.append("neither the log nor the status line announces new messages")

# the group id must be an id the registry actually has
registry_ids = set(people.get("GROUPS", {}).keys())
if not registry_ids:
    errs.append("people.json has no GROUPS registry, so there is nothing to chat about")
# The link is built in script.js, not written into community.html, so the page
# itself never mentions group.html. Checking the renderer instead of the markup
# is the point: a link that only exists in the HTML would render nothing.

# every class the page and the script use is actually styled
used = set(re.findall(r'class="([^"]+)"', groups_page))
used |= set(re.findall(r"'(chat__[a-z]+)", js)) | set(re.findall(r'"(chat__[a-z]+)', js))
unstyled = sorted(
    c for group in used for c in group.split()
    if c.startswith("chat") and not re.search(rf"\.{re.escape(c)}\b", css)
)
if unstyled:
    errs.append(f"unstyled chat classes: {', '.join(unstyled)}")

# --------------------------------------------------------------------------

print(f"chat page   : {len(chat_ids)} ids read, all declared: {not missing}")
print(f"registry    : {len(registry_ids)} groups a chat can be opened for")
print(f"images      : jpeg, png, gif, webp by magic byte; svg refused")
print(f"limits      : {re.search(r'CHAT_MAX_TEXT = (\d+)', js).group(1)} characters, "
      f"{re.search(r'CHAT_MAX_EDGE = (\d+)', js).group(1)}px longest edge")
print("posting     : members only, re-checked at send time")
print("storage     : IndexedDB, messages and images in one transaction")

if errs:
    print(f"\nERRORS ({len(errs)}):")
    for e in errs:
        print("  - " + e)
    sys.exit(1)

print("\nOK - the group chat page, its image rules and its membership gate are sound")
