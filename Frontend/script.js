/* =========================================================
   Future Era — intro animation timeline
   ========================================================= */

/* Removes missing elements so GSAP never gets a null target */
function pick(list) {
    return list.flat().filter(Boolean);
}

/* =========================================================
   Motion capability
   =========================================================
   A lot of the CSS starts elements at opacity: 0 so GSAP can fade them in.
   Two things stop GSAP from ever running: a visitor who asked for reduced
   motion, and the vendor file failing to load. In both cases nothing would
   bring those elements back and the text would stay invisible forever, so
   every animation is gated on MOTION.ok and .no-motion cancels the CSS
   starting state. */
const MOTION = {
    reduced: !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    ok: typeof window.gsap !== "undefined"
};
MOTION.ok = MOTION.ok && !MOTION.reduced;

/* Runs an init step, and swallows a failure so one broken section cannot
   take the rest of the page's animations down with it. */
function step(name, fn) {
    if (typeof fn !== "function") return;
    try {
        fn();
    } catch (err) {
        if (window.console) console.error(`[future-era] ${name} failed:`, err);
    }
}

/* =========================================================
   Navbar: solid bar on scroll, mobile menu, active link
   ========================================================= */
function initNav() {
    const nav = document.querySelector(".nav");
    const toggle = document.querySelector(".nav__toggle");
    const links = document.querySelector(".nav__links");

    /* Nothing in the navbar is an animation, so it must not reach for gsap -
       the whole point is that the menu and the active link still work on a
       page where the library never loaded. */
    const navLinks = Array.from(document.querySelectorAll(".nav__link"));

    if (nav) {
        const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 24);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
    }

    if (toggle && links) {
        const close = () => {
            links.classList.remove("is-open");
            toggle.setAttribute("aria-expanded", "false");
        };

        toggle.addEventListener("click", () => {
            const open = links.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", String(open));
        });

        links.addEventListener("click", (e) => {
            if (e.target.closest("a")) close();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close();
        });
    }

    /* highlight the link for the section currently in view (same-page hashes only) */
    if (navLinks.length) {
        const sections = navLinks
            .map((a) => a.getAttribute("href"))
            .filter((href) => href && href.startsWith("#"))
            .map((href) => document.querySelector(href))
            .filter(Boolean);

        if (sections.length) {
            const highlight = (y) => {
                let current = sections[0];
                sections.forEach((s) => {
                    if (s.offsetTop <= y + window.innerHeight * 0.4) current = s;
                });
                if (!current) return;
                navLinks.forEach((a) =>
                    a.classList.toggle("is-active", a.getAttribute("href") === `#${current.id}`)
                );
            };

            /* ScrollTrigger drives this when it is available. Without it the
               same highlight still runs off a plain scroll listener, so the
               active-link behaviour is not tied to the animation library. */
            if (MOTION.ok && window.ScrollTrigger) {
                ScrollTrigger.create({
                    trigger: document.body,
                    start: "top top",
                    end: "bottom bottom",
                    onUpdate: (self) => highlight(self.scroll()),
                });
            } else {
                let queued = false;
                window.addEventListener("scroll", () => {
                    if (queued) return;
                    queued = true;
                    window.requestAnimationFrame(() => {
                        queued = false;
                        highlight(window.scrollY);
                    });
                }, { passive: true });
                highlight(window.scrollY);
            }
        }
    }
}

/* =========================================================
   Log in / sign up modal
   =========================================================
   Front-end only, and deliberately so: the dialog, the tab switch and every
   validation below are plain DOM, so none of it depends on GSAP having loaded.
   <dialog> gives us the top layer, the backdrop and Escape for free.

   Passwords are hashed with SHA-256 and kept in localStorage on this device.
   That is enough to make the flow real for a demo but it is NOT authentication
   - anyone with devtools can read it and nothing is verified against a server.
   Real accounts need routes in Backend/main.py. */
const AUTH_USERS = "future-era:users";
const AUTH_SESSION = "future-era:session";

/* Where a successful sign in lands. Every page sits in the same folder, so a
   plain relative name is enough and works from any of them. */
const HOME_PAGE = "index.html";

function initAuth() {
    const dialog = document.getElementById("auth-dialog");
    /* every trigger on the page, not just the navbar one: community.html also
       carries a "Log in" button in its closing call to action, and
       querySelector would have left that second button doing nothing */
    const openBtns = Array.from(document.querySelectorAll("[data-auth-open]"));

    /* career.html has no navbar, so it carries no dialog either */
    if (!dialog || !openBtns.length) return;

    const who = document.querySelector("[data-auth-who]");
    const msg = document.getElementById("auth-msg");
    const closeBtn = dialog.querySelector("[data-auth-close]");
    const tabs = Array.from(dialog.querySelectorAll("[data-auth-tab]"));
    const panels = {
        login: document.getElementById("auth-panel-login"),
        signup: document.getElementById("auth-panel-signup"),
    };

    const store = {
        read(key) {
            try {
                return JSON.parse(window.localStorage.getItem(key)) || {};
            } catch (err) {
                return {};
            }
        },
        write(key, value) {
            try {
                window.localStorage.setItem(key, JSON.stringify(value));
            } catch (err) {
                /* storage blocked or private mode - the form still works for
                   this page view, it just will not be remembered */
            }
        },
        drop(key) {
            try {
                window.localStorage.removeItem(key);
            } catch (err) {
                /* nothing to clean up if storage is unavailable */
            }
        },
    };

    const val = (panel, id) => {
        const el = panel.querySelector("#" + id);
        return el ? String(el.value || "").trim() : "";
    };

    const say = (text, ok) => {
        if (!msg) return;
        msg.textContent = text;
        msg.classList.toggle("auth__msg--ok", !!ok);
        msg.classList.add("is-shown");
    };

    const hush = () => {
        if (!msg) return;
        msg.textContent = "";
        msg.classList.remove("is-shown", "auth__msg--ok");
    };

    const setTab = (name) => {
        tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.authTab === name)));
        Object.keys(panels).forEach((key) => {
            if (panels[key]) panels[key].classList.toggle("is-active", key === name);
        });
    };

    /* swaps the nav button for a "signed in" chip, and back on sign out */
    const renderWho = () => {
        const session = store.read(AUTH_SESSION);
        const signedIn = !!(session && session.email);

        openBtns.forEach((btn) => btn.classList.toggle("is-hidden", signedIn));

        if (who) {
            who.classList.toggle("is-shown", signedIn);

            const badge = who.querySelector("[data-auth-initial]");
            if (badge && signedIn) {
                const seed = String(session.name || session.email || "F").trim();
                badge.textContent = seed.charAt(0).toUpperCase();
            }
        }

        /* Follows are stored per account, so anything rendering a follow button
           has to repaint when the account changes. Announced from here rather
           than at each call site so signing in, signing out and the first render
           all say the same thing. */
        window.dispatchEvent(new CustomEvent("future-era:session"));
    };

    const open = (name) => {
        const tab = name || "login";
        setTab(tab);
        hush();

        /* on mobile the dropdown would otherwise sit open behind the dialog */
        const links = document.getElementById("nav-links");
        const toggle = document.getElementById("nav-toggle");
        if (links) links.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");

        if (typeof dialog.showModal === "function") {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }

        const panel = panels[tab] || panels.login;
        const first = panel && panel.querySelector ? panel.querySelector(".inp") : null;
        if (first) window.setTimeout(() => first.focus(), 30);
    };

    const close = () => {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
    };

    /* Signing in always ends on the home page. Deliberately not a
       "first sign in only" branch and not a once-per-session flag: signing in
       again, from any page, lands on home every time - the dialog is a
       doorman, not a doorway you only go through once.

       The pause is so "Signed in. Welcome back." is actually readable before
       the page goes, and so the session event dispatched by renderWho above
       has landed before the document is torn down. Guarded on `assign`
       existing so the function is inert in a test harness with no location,
       rather than throwing where it cannot be caught. */
    const land = (message, panel) => {
        say(message, true);

        /* Nothing in here may be allowed to stop the redirect. An earlier
           version called panel.reset() unguarded, on the assumption that the
           panel is always present because the dialog is: a missing panel threw
           a TypeError, and because the setTimeout came after it, the
           navigation was never even scheduled. The dialog closed, the visitor
           stayed put, and nothing was logged anywhere. */
        try {
            if (panel && typeof panel.reset === "function") panel.reset();
        } catch (err) {
            /* a form that does not clear is not worth losing the move over */
        }

        window.setTimeout(() => {
            close();
            if (window.location && typeof window.location.assign === "function") {
                window.location.assign(HOME_PAGE);
            }
        }, 900);
    };

    openBtns.forEach((btn) => btn.addEventListener("click", () => open("login")));
    if (closeBtn) closeBtn.addEventListener("click", close);

    /* The suggestion slide needs to ask for an account when someone follows
       while signed out, and it has no business knowing how this popup opens.
       A window event rather than a shared function so the two stay decoupled
       and neither has to exist for the other. */
    window.addEventListener("future-era:open-auth", () => open("login"));

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            setTab(tab.dataset.authTab);
            hush();
        });
    });

    /* a click on the dimmed backdrop lands on the dialog element itself, while a
       click inside the panel does not - so this closes on backdrop only */
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) close();
    });

    const signout = document.querySelector("[data-auth-signout]");
    if (signout) {
        signout.addEventListener("click", () => {
            store.drop(AUTH_SESSION);
            renderWho();
        });
    }

    if (panels.signup) {
        panels.signup.addEventListener("submit", (e) => {
            e.preventDefault();

            const name = val(panels.signup, "auth-signup-name");
            const email = val(panels.signup, "auth-signup-email").toLowerCase();
            const pass = val(panels.signup, "auth-signup-pass");

            if (!name) return say("Please enter your name.");
            if (!looksLikeEmail(email)) return say("That email does not look right.");
            if (pass.length < 6) return say("Password needs to be at least 6 characters.");

            const users = store.read(AUTH_USERS);
            if (users[email]) return say("That email is already registered. Try logging in.");

            digest(email + "::" + pass).then((hash) => {
                users[email] = { name: name, email: email, hash: hash };
                store.write(AUTH_USERS, users);
                store.write(AUTH_SESSION, { name: name, email: email });
                renderWho();
                land("Account created. Taking you home.", panels.signup);
            });
        });
    }

    if (panels.login) {
        panels.login.addEventListener("submit", (e) => {
            e.preventDefault();

            const email = val(panels.login, "auth-login-email").toLowerCase();
            const pass = val(panels.login, "auth-login-pass");

            if (!looksLikeEmail(email)) return say("That email does not look right.");
            if (!pass) return say("Please enter your password.");

            const users = store.read(AUTH_USERS);
            const user = users[email];
            if (!user) return say("No account with that email. Sign up first.");

            digest(email + "::" + pass).then((hash) => {
                if (hash !== user.hash) return say("That password does not match.");
                store.write(AUTH_SESSION, { name: user.name, email: user.email });
                renderWho();
                land("Signed in. Taking you home.", panels.login);
            });
        });
    }

    renderWho();
}

function initIntro() {
    const welcomeEl = document.querySelector(".intro__title");
    const futureEl = document.querySelector(".intro__title1");
    const subEl = document.querySelector(".intro__subtitle");

    const els = {
        eyebrow: document.querySelector(".intro__eyebrow"),
        rule: document.querySelector(".intro__rule span"),
        actions: document.querySelector(".intro__actions"),
        cue: document.querySelector(".scroll-cue"),
        cueLine: document.querySelector(".scroll-cue__line i"),
    };

    /* no hero on this page (e.g. creators.html) - nothing to animate */
    if (!welcomeEl) return;

    /* The hero starts at opacity: 0 in the CSS and is only ever revealed by
       this timeline. Without GSAP there is nothing to reveal it, so bail out
       and let .no-motion put it back. */
    if (!MOTION.ok) return;

    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    const btns = gsap.utils.toArray(".intro__actions .btn");

    /* The eyebrow is only on the home hero, so it is resolved with pick() like
       everything else optional here. It and the scroll cue are both faded out
       first and faded back in below - leaving the eyebrow out of that second
       pass is what used to keep it stuck at opacity 0 forever. */
    const reveal = pick([els.eyebrow, els.cue]);

    /* every element leaves from its own edge */
    gsap.set(welcomeEl, { opacity: 0, xPercent: -120, y: 0 });
    gsap.set(futureEl, { opacity: 0, xPercent: 120, y: 0 });
    gsap.set(subEl, { opacity: 0, xPercent: 0, y: 80 });
    gsap.set(els.actions, { opacity: 1 });
    gsap.set(btns, {
        opacity: 0,
        y: 40,
        scale: 0.85,
    });

    tl.set(reveal, { opacity: 0 })

        /* rule draws in, then the headlines sweep in from opposite sides */
        .to(pick([els.rule]), { scaleX: 1, duration: 1.6, ease: "power3.inOut" }, 0.25)
        .to(pick([welcomeEl]), { opacity: 1, xPercent: 0, duration: 1 }, 0.6)
        .to(pick([futureEl]), { opacity: 1, xPercent: 0, duration: 1 }, 0.95)

        /* "The GenX Era" blooms up from below */
        .to(pick([subEl]), { opacity: 1, y: 0, duration: 1.1, ease: "expo.out" }, 1.5)

        /* buttons surface, staggered out of the floor */
        .to(btns, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.9,
            ease: "expo.out",
            stagger: 0.12,
        }, 2)

        /* eyebrow and scroll cue fade up together */
        .to(reveal, { opacity: 1, duration: 1, stagger: 0.12 }, 2)
        .to(pick([els.cueLine]), { scaleY: 1, duration: 0.8, ease: "power2.inOut" }, "<0.2")

        /* Scroll cue loop.
           This has to be a fromTo, not a .to(). An infinitely repeating .to()
           animates exactly once: the first iteration ends on scaleY 0, so every
           iteration after it starts and finishes on 0 and nothing moves. The
           line drew down once and then sat invisible. A fromTo restates its
           from-values on every repeat, so the line keeps resetting to the top
           and growing back down. */
        .fromTo(pick([els.cueLine]),
            { scaleY: 0, transformOrigin: "top" },
            {
                scaleY: 1,
                duration: 0.9,
                ease: "power2.inOut",
                repeat: -1,
                repeatDelay: 0.35,
            });
}

function initAbout() {
    if (!MOTION.ok) return;

    gsap.utils.toArray("#about [data-reveal]").forEach((el) => {
        gsap.from(el, {
            y: 48,
            opacity: 0,
            duration: 1,
            ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 88%" },
        });
    });

    gsap.utils.toArray(".about__copy p").forEach((p, i) => {
        gsap.from(p, {
            y: 28,
            opacity: 0,
            duration: 0.9,
            delay: i * 0.1,
            ease: "power3.out",
            scrollTrigger: { trigger: ".about__body", start: "top 85%" },
        });
    });
}

function initCreators() {
    const section = document.querySelector("#creators");
    if (!section) return;

    if (!MOTION.ok) return;

    /* header + closing row */
    gsap.utils.toArray("#creators [data-reveal]").forEach((el) => {
        gsap.from(el, {
            y: 48,
            opacity: 0,
            duration: 1,
            ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 88%" },
        });
    });

    /* each row is tied to the scrollbar, so the list assembles as you scroll */
    gsap.utils.toArray(".creator").forEach((row) => {
        gsap.from(row, {
            y: 70,
            opacity: 0,
            ease: "none",
            scrollTrigger: {
                trigger: row,
                start: "top 95%",
                end: "top 58%",
                scrub: 0.6,
            },
        });
    });

    /* progress rail fills alongside the rows */
    const rail = section.querySelector(".creators__rail span");
    const list = section.querySelector(".creators__list");

    if (rail && list) {
        gsap.fromTo(
            rail,
            { scaleY: 0 },
            {
                scaleY: 1,
                ease: "none",
                scrollTrigger: {
                    trigger: list,
                    start: "top 80%",
                    end: "bottom 60%",
                    scrub: 0.4,
                },
            }
        );
    }

    gsap.utils.toArray(".creator__role").forEach((role) => {
        const card = role.closest(".creator");
        card.addEventListener("mouseenter", () =>
            gsap.to(role, { letterSpacing: "0.32em", duration: 0.5, ease: "expo.out" })
        );
        card.addEventListener("mouseleave", () =>
            gsap.to(role, { letterSpacing: "0.2em", duration: 0.5, ease: "expo.out" })
        );
    });
}

/* =========================================================
   Community — channels and the latest discussion
   =========================================================
   Same shape as the creators page: the header fades up on scroll, each thread is
   tied to the scrollbar so the list assembles as you read, and the rail fills
   alongside. Every reveal is a gsap.from(), so the markup carries no
   opacity: 0 of its own and the page is fully readable with motion off. */
function initCommunity() {
    const section = document.querySelector("#community");
    if (!section) return;

    if (!MOTION.ok) return;

    /* header, channel cards and the closing row */
    gsap.utils.toArray("#community [data-reveal]").forEach((el) => {
        gsap.from(el, {
            y: 48,
            opacity: 0,
            duration: 1,
            ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 88%" },
        });
    });

    /* each thread is tied to the scrollbar */
    gsap.utils.toArray(".thread").forEach((row) => {
        gsap.from(row, {
            y: 70,
            opacity: 0,
            ease: "none",
            scrollTrigger: {
                trigger: row,
                start: "top 95%",
                end: "top 58%",
                scrub: 0.6,
            },
        });
    });

    /* the rail fills alongside the list */
    const rail = section.querySelector(".community__rail span");
    const list = section.querySelector(".community__list");

    if (rail && list) {
        gsap.fromTo(
            rail,
            { scaleY: 0 },
            {
                scaleY: 1,
                ease: "none",
                scrollTrigger: {
                    trigger: list,
                    start: "top 80%",
                    end: "bottom 60%",
                    scrub: 0.4,
                },
            }
        );
    }

    /* the channel name tracks the tag colour on hover, matching the creators row */
    gsap.utils.toArray(".channel__count").forEach((count) => {
        const card = count.closest(".channel");
        if (!card) return;
        card.addEventListener("mouseenter", () =>
            gsap.to(count, { letterSpacing: "0.3em", duration: 0.5, ease: "expo.out" })
        );
        card.addEventListener("mouseleave", () =>
            gsap.to(count, { letterSpacing: "0.2em", duration: 0.5, ease: "expo.out" })
        );
    });
}

/* =========================================================
   Community: the suggestion slide, and who you follow
   =========================================================
   The member list, the tag vocabularies and the match score all arrive from
   /api/people, so the ranking rule lives in Python where check_people.py can
   test it. This only renders what it is handed and keeps the two bits of local
   state: the tags you picked, and who you follow.

   The tags are a single anonymous bucket. They exist to rank the slide and
   nothing is private in them. Follows are keyed by account, because who you
   follow is per-person - and following needs an account at all: with nobody
   signed in the button opens the log in popup rather than appearing to work
   and storing nothing. */
const FOLLOWS_KEY = "future-era:follows:";
const PROFILE_KEY = "future-era:profile";

/* Member text is interpolated into markup, so it gets escaped. The data is our
   own, but the rule costs nothing and a name containing an apostrophe quietly
   breaking a card is not worth the risk. */
function esc(text) {
    return String(text == null ? "" : text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function readStore(key, fallback) {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        return fallback;
    }
}

function writeStore(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        /* storage blocked or private mode - the slide still works for this
           page view, it just will not be remembered */
    }
}

/* SHA-256 where the browser exposes it (https or localhost), otherwise a
   cheap stand-in so the flow still behaves on a plain http:// origin. Neither
   is a real KDF - hashing at all is only here to keep the password out of
   readable text. */
function digest(text) {
    const subtle = window.crypto && window.crypto.subtle;
    if (subtle && window.TextEncoder) {
        return subtle
            .digest("SHA-256", new window.TextEncoder().encode(text))
            .then((buf) =>
                Array.from(new Uint8Array(buf))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")
            );
    }
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
    return Promise.resolve("weak:" + h);
}

function looksLikeEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/* ---------- group membership, in one place ----------
   The community group list and the group chat page both change which groups you
   are in, so the read and the write live here rather than being written twice
   and drifting - the profile popup would end up showing a group you had just
   removed. The popup itself only reads. */

const sessionOf = () => readStore(AUTH_SESSION, {}) || {};

const userRecord = (email) => {
    const users = readStore(AUTH_USERS, {}) || {};
    return email && users[email] ? users[email] : {};
};

/* Membership lives on the account record rather than under a key of its own, so
   signing out - which clears the session - cannot leave a stranded list behind,
   and the groups travel with the account. */
function myGroups() {
    const g = userRecord(sessionOf().email).groups;
    return Array.isArray(g) ? g : [];
}

function setMyGroups(ids) {
    const s = sessionOf();
    if (!s.email) return false;

    const users = readStore(AUTH_USERS, {}) || {};
    const rec = users[s.email] || { name: s.name, email: s.email };
    rec.groups = ids;
    users[s.email] = rec;
    writeStore(AUTH_USERS, users);

    /* whoever else is showing the same list has to hear about it, or the popup
       and the community page disagree until the next reload */
    window.dispatchEvent(new CustomEvent("future-era:groups-changed"));
    return true;
}

/* ---------- the ranked payload, fetched once ----------
   The member slide and the group suggestions are both ranked from the same
   picks by the same request. Fetching it twice would mean two responses that
   could disagree, and the page would make a request it does not need - so the
   slide fetches, and hands the payload on. Kept in a variable as well as an
   event because the group list is initialised after the slide and would
   otherwise miss the first one. */
let RANKED = null;

function announceRanked(data) {
    RANKED = data;
    window.dispatchEvent(new CustomEvent("future-era:ranked", { detail: data }));
}

function initCommunityFollow() {
    const slide = document.getElementById("people-slide");
    const interestBox = document.getElementById("people-interests");
    const skillBox = document.getElementById("people-skills");
    const status = document.getElementById("people-status");
    const filter = document.getElementById("people-skill-filter");

    if (!slide || !interestBox || !skillBox) return;

    let vocabulary = { interests: [], skills: [] };
    let label = { interests: {}, skills: {} };
    let mine = { interests: [], skills: [] };
    let shown = [];

    const stored = readStore(PROFILE_KEY, {}) || {};
    mine.interests = Array.isArray(stored.interests) ? stored.interests : [];
    mine.skills = Array.isArray(stored.skills) ? stored.skills : [];

    const followKey = () => {
        const session = readStore(AUTH_SESSION, {}) || {};
        return session.email ? FOLLOWS_KEY + session.email : "";
    };

    const following = () => {
        const key = followKey();
        const list = key ? readStore(key, []) : [];
        return Array.isArray(list) ? list : [];
    };

    const labelOf = (kind, id) => label[kind][id] || id;

    /* ---------- the request ---------- */
    const load = () => {
        const q = new URLSearchParams();
        if (mine.interests.length) q.set("interests", mine.interests.join(","));
        if (mine.skills.length) q.set("skills", mine.skills.join(","));
        const query = q.toString();

        return fetch("/api/people" + (query ? "?" + query : ""))
            .then((res) => {
                if (!res.ok) throw new Error("server said " + res.status);
                return res.json();
            })
            .then((data) => {
                vocabulary = { interests: data.interests || [], skills: data.skills || [] };
                label = {
                    interests: Object.fromEntries(vocabulary.interests.map((t) => [t.id, t.label])),
                    skills: Object.fromEntries(vocabulary.skills.map((t) => [t.id, t.label])),
                };

                /* the server drops tags it does not know, so trust its answer
                   rather than what is in storage - that is what it ranked on */
                if (data.mine) {
                    mine.interests = data.mine.interests || [];
                    mine.skills = data.mine.skills || [];
                }

                renderChips();
                renderPeople(data.people || []);

                /* the group suggestions come out of this same response, ranked
                   for this same visitor */
                announceRanked(data);
            });
    };

    /* ---------- the tag picker ---------- */
    const chip = (kind, id, text) =>
        '<button class="chip" type="button" data-tag="' + esc(id) + '" data-kind="' + kind + '"' +
        ' aria-pressed="' + (mine[kind].indexOf(id) > -1 ? "true" : "false") + '">' +
        esc(text) + "</button>";

    const renderChips = () => {
        interestBox.innerHTML = vocabulary.interests
            .map((t) => chip("interests", t.id, t.label))
            .join("");

        const needle = filter ? String(filter.value || "").trim().toLowerCase() : "";
        const shown = vocabulary.skills.filter(
            (t) => !needle || t.label.toLowerCase().indexOf(needle) > -1 || t.id.indexOf(needle) > -1
        );

        skillBox.innerHTML = shown.length
            ? shown.map((t) => chip("skills", t.id, t.label)).join("")
            : '<span class="person__followers">No skill matches that.</span>';
    };

    const toggleTag = (kind, id) => {
        const at = mine[kind].indexOf(id);
        if (at > -1) mine[kind].splice(at, 1);
        else mine[kind].push(id);

        writeStore(PROFILE_KEY, mine);
        load().catch(showPeopleError);
    };

    /* ---------- one card ---------- */
    const card = (person, followed) => {
        const match = person.match || {};
        const scored = match.score !== null && match.score !== undefined;
        const shared = (match.interests || []).concat(match.skills || []);
        const mineSet = new Set(shared);

        /* Shared tags first and in the accent, so the reason for the suggestion
           is visible before the number is. */
        const tags = (person.skills || [])
            .slice(0, 4)
            .map((id) => tagChip(id, mineSet.has(id)))
            .join("");

        const why = scored
            ? (shared.length
                ? "Shares " +
                  (match.interests || []).length + " of your interests and " +
                  (match.skills || []).length + " of your skills"
                : "No overlap yet - same direction, different toolkits")
            : "Pick a tag above and this gets ranked";

        return (
            '<article class="person' + (followed ? " is-following" : "") + '" role="listitem" data-person="' +
            esc(person.id) + '">' +
            '<div class="person__top">' +
            /* the name and the avatar open the full profile. A button rather than
               a wrapper div: the card is an <article> with a Follow button already
               in it, and a div with a click handler would be invisible to the
               keyboard - the one way somebody can use this without a pointer. The
               card's own heading was the <h3> that used to be here, and the
               button's accessible name is the name, so nothing is lost. */
            '<button class="person__open" type="button" data-person-open="' + esc(person.id) + '"' +
            ' aria-haspopup="dialog" aria-label="' +
            esc("See " + person.name + "'s full profile") + '">' +
            '<span class="person__avatar" aria-hidden="true">' + esc(person.name.charAt(0).toUpperCase()) + "</span>" +
            '<span class="person__id">' +
            '<span class="person__name">' + esc(person.name) + "</span>" +
            '<span class="person__handle">' + esc(person.handle) + "</span>" +
            "</span></button>" +
            "</div>" +
            '<span class="person__role">' + esc(person.roleLabel) + "</span>" +
            '<p class="person__blurb">' + esc(person.blurb) + "</p>" +
            (tags ? '<div class="person__tags">' + tags + "</div>" : "") +
            '<p class="person__why">' + esc(why) + "</p>" +
            '<div class="person__foot">' +
            '<span class="person__score">' +
            (scored ? "<b>" + esc(match.score) + "%</b> match" : "not ranked") +
            "</span>" +
            '<button class="follow" type="button" data-follow="' + esc(person.id) + '"' +
            ' aria-pressed="' + (followed ? "true" : "false") + '">' +
            (followed ? "Following" : "Follow") +
            "</button>" +
            "</div>" +
            '<span class="person__followers">' + esc(person.followers) + " followers</span>" +
            "</article>"
        );
    };

    const tagChip = (id, isShared) =>
        '<span class="tag' + (isShared ? " tag--shared" : "") + '">' +
        esc(labelOf("skills", id)) +
        "</span>";

    const renderPeople = (list) => {
        const followed = following();

        /* kept so a click on a name can hand the popup the record behind it. The
           popup is on every page with a navbar and fetches the same list itself,
           but this is the copy already on screen, so the profile opens filled in
           rather than blank while that request is in flight. */
        shown = list;

        if (!list.length) {
            slide.innerHTML = '<p class="people__empty">Nobody to suggest right now.</p>';
            return;
        }

        slide.innerHTML = list.map((p) => card(p, followed.indexOf(p.id) > -1)).join("");

        if (status) {
            const bits = [];
            if (mine.interests.length) {
                bits.push(mine.interests.length + (mine.interests.length === 1 ? " interest" : " interests"));
            }
            if (mine.skills.length) {
                bits.push(mine.skills.length + (mine.skills.length === 1 ? " skill" : " skills"));
            }

            status.innerHTML = bits.length
                ? list.length + " members, ranked by your <b>" + bits.join("</b> and <b>") + "</b>"
                : list.length + (list.length === 1 ? " member" : " members") + ", most followed first";
        }

        syncArrows();
    };

    /* ---------- following ---------- */
    const flipFollow = (id, button) => {
        const key = followKey();
        if (!key) {
            /* Nobody signed in. Rather than store a follow against nobody, ask
               for an account - initAuth listens for this event. */
            window.dispatchEvent(new CustomEvent("future-era:open-auth"));
            return;
        }

        const list = following();
        const at = list.indexOf(id);
        const nowFollowing = at === -1;
        if (nowFollowing) list.push(id);
        else list.splice(at, 1);

        writeStore(key, list);

        const article = button.closest(".person");
        if (article) {
            const on = nowFollowing;
            article.classList.toggle("is-following", on);
            button.setAttribute("aria-pressed", String(on));
            button.textContent = on ? "Following" : "Follow";
        }
    };

    /* ---------- the slide arrows ---------- */
    const prev = document.querySelector("[data-people-prev]");
    const next = document.querySelector("[data-people-next]");

    const syncArrows = () => {
        const max = slide.scrollWidth - slide.clientWidth - 1;
        if (prev) prev.disabled = slide.scrollLeft <= 1;
        if (next) next.disabled = slide.scrollLeft >= max;
    };

    const nudge = (dir) => {
        const card = slide.querySelector(".person");
        const width = card ? card.getBoundingClientRect().width + 14 : slide.clientWidth * 0.8;
        slide.scrollBy({ left: dir * width * 2, behavior: MOTION.ok ? "smooth" : "auto" });
    };

    if (prev) prev.addEventListener("click", () => nudge(-1));
    if (next) next.addEventListener("click", () => nudge(1));
    slide.addEventListener("scroll", syncArrows, { passive: true });
    window.addEventListener("resize", syncArrows);

    /* ---------- events ---------- */
    const onChip = (e) => {
        const button = e.target.closest("[data-tag]");
        if (button) toggleTag(button.dataset.kind, button.dataset.tag);
    };

    const onFollow = (e) => {
        const button = e.target.closest("[data-follow]");
        if (button) flipFollow(button.dataset.follow, button);
    };

    /* Opening somebody's full profile is the popup's job, not this card's: the
       popup is the only thing on the site that can render one, and it exists on
       every page with a navbar. So the card asks for it over a window event
       rather than building a second profile view here. */
    const onOpenProfile = (e) => {
        const button = e.target.closest("[data-person-open]");
        if (!button) return;

        const id = button.dataset.personOpen;
        /* resolved from the list that was painted rather than off the attribute,
           so the record and the button cannot disagree about who this is */
        const person = shown.filter((p) => p.id === id)[0];

        window.dispatchEvent(new CustomEvent("future-era:open-member", {
            detail: { id: id, person: person || null },
        }));
    };

    interestBox.addEventListener("click", onChip);
    skillBox.addEventListener("click", onChip);
    slide.addEventListener("click", onFollow);
    slide.addEventListener("click", onOpenProfile);

    if (filter) {
        filter.addEventListener("input", () => renderChips());
    }

    /* Signing in or out changes which account the follows belong to, so the
       cards have to be repainted or the buttons would claim the wrong state. */
    window.addEventListener("future-era:session", () => {
        if (slide.querySelector(".person")) load().catch(showPeopleError);
    });

    load().catch(showPeopleError);
}

/* The backend being down should say so rather than leave a slide that reads as
   "nobody to follow". */
function showPeopleError(err) {
    const slide = document.getElementById("people-slide");
    if (slide) {
        slide.innerHTML =
            '<p class="people__empty" role="alert">Could not load the member list (' +
            String(err.message || err) +
            "). Start the backend with <code>python main.py</code> and reload.</p>";
    }
    if (window.console) console.error("community members failed to load:", err);
}

/* =========================================================
   Career blueprint — one scrolling form, two paths
   ========================================================= */

const CAREER_PATHS = [
    {
        id: 'student', label: '12th Pass Student',
        blurb: 'School just ended. No degree, no plan — and no reason that has to be a problem.'
    },
    {
        id: 'grad', label: 'Graduated Professional',
        blurb: 'You have the degree and probably the doubt. Both are useful, neither lasts forever.'
    }
];

/* "React JS" / "react.js" / "ReactJS" all collapse to the same key */
function normKey(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9+#]/g, '');
}

function tokens(s) {
    return String(s).toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
}

/* free-typed skill -> real skill id, or null if we have no data for it
   Built LAZILY on purpose. This index reads SKILLS from career-data.js, which
   only the career page loads. Building it at top level threw
   "ReferenceError: SKILLS is not defined" on the home and creators pages,
   which aborted script.js before init() ran and killed every GSAP animation
   on those pages. */
let SKILL_BY_KEY = null;
function skillIndex() {
    if (SKILL_BY_KEY) return SKILL_BY_KEY;
    const m = new Map();
    SKILLS.forEach(s => {
        m.set(normKey(s.id), s.id);
        (s.aliases || []).forEach(a => {
            const k = normKey(a);
            if (!m.has(k)) m.set(k, s.id);
        });
    });
    return (SKILL_BY_KEY = m);
}

const byId = (list, id) => list.find(x => x.id === id) || null;

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for', 'developer', 'engineer']);

/* best-guess match of a typed role name onto one of our ROLES */
function matchRole(text) {
    const q = tokens(text).filter(t => !STOP.has(t));
    if (!q.length) return null;

    const norm = normKey(text);
    for (const id of Object.keys(ROLES)) {
        if (normKey(id) === norm || normKey(ROLES[id].label) === norm) return id;
    }

    let best = null, bestScore = 0;
    for (const [id, r] of Object.entries(ROLES)) {
        const rt = new Set(tokens(r.label).filter(t => !STOP.has(t)));
        const score = q.reduce((n, t) => n + (rt.has(t) ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; best = id; }
    }
    return bestScore ? best : null;
}

/* Career page hero entrance.
   The hero sits above the fold, so this plays on load rather than on scroll,
   and matches the expo.out timing used by initAbout/initCreators.

   It deliberately lives outside initCareer. initCareer only runs once the
   career data has been fetched, so keeping the entrance in there meant that a
   slow or unreachable backend left this page with no animation at all. It uses
   gsap.from, which restores the CSS values on its own, so there is no
   opacity:0 starting state to undo when motion is off. */
function initCareerHero() {
    if (!MOTION.ok) return;
    if (!document.querySelector("#career [data-reveal]")) return;

    gsap.from("#career [data-reveal]", {
        y: 48,
        opacity: 0,
        duration: 1,
        ease: "expo.out",
        stagger: 0.12,
        clearProps: "transform,opacity"
    });
}

function initCareer() {
    const form = document.getElementById('pathform');
    const section = document.getElementById('career');
    const bp = document.getElementById('blueprint');
    if (!form || !section || !bp) return;

    /* only now, on a page that actually has the data */
    SKILL_BY_KEY = skillIndex();

    const el = id => document.getElementById(id);

    const state = {
        path: '',
        stream: '',
        interest: new Set(),
        interestOther: '',
        hobby: new Set(),
        hobbyOther: '',
        degree: '',
        duration: new Set(),
        skills: new Set(),
        skillChips: [],
        role: ''
    };

    /* ---------- option builders ---------- */

    function buildOptions(container, items, type, name, selected) {
        if (!container) return;
        container.innerHTML = '';
        items.forEach(item => {
            const id = `${name}-${item.id}`;
            const label = document.createElement('label');
            label.className = 'opt';
            label.htmlFor = id;

            const input = document.createElement('input');
            input.type = type;
            input.name = name;
            input.id = id;
            input.value = item.id;
            input.checked = selected ? selected.has(item.id) : false;

            const text = document.createElement('span');
            text.className = 'opt__text';
            text.textContent = item.label;

            label.append(input, text);
            container.append(label);
        });
    }

    /* ---------- static option lists ---------- */

    buildOptions(el('path-opts'), CAREER_PATHS, 'radio', 'path', null);
    buildOptions(el('stu-stream'), STREAMS, 'radio', 'stu-stream', new Set());
    buildOptions(el('stu-interest'), INTERESTS, 'checkbox', 'stu-interest', new Set());
    buildOptions(el('stu-hobbies'), HOBBIES, 'checkbox', 'stu-hobbies', new Set());
    refreshGradSkills();

    /* ---------- degree + duration depend on stream / degree ---------- */

    function refreshDegrees() {
        /* The student path narrows the degree list to the chosen stream and
           stays disabled until one is picked. The grad path has no stream
           question at all, so it always offers every degree. */
        const isStudent = state.path !== 'grad';
        const sel = isStudent ? el('stu-degree') : el('grad-degree');
        const hint = isStudent ? el('stu-degree-hint') : el('grad-degree-hint');
        if (!sel) return;

        const keep = state.degree;
        const allowed = isStudent
            ? DEGREES.filter(d => !state.stream || (d.streams || []).includes(state.stream))
            : DEGREES;

        sel.innerHTML = '';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = isStudent && !state.stream ? 'Pick a stream first' : 'Choose a degree';
        sel.append(blank);

        allowed.forEach(d => {
            const o = document.createElement('option');
            o.value = d.id;
            o.textContent = d.label;
            sel.append(o);
        });

        sel.disabled = isStudent && !state.stream;
        if (allowed.some(d => d.id === keep)) sel.value = keep;
        else { sel.value = ''; state.degree = ''; }

        if (hint) {
            hint.textContent = isStudent
                ? (state.stream
                    ? (allowed.length ? '' : 'No degree in our list matches that stream - change the stream above.')
                    : 'Pick a stream first.')
                : '';
        }
    }

    function refreshDuration() {
        const box = el('stu-duration');
        if (!box) return;
        const deg = byId(DEGREES, state.degree);
        const allowed = deg ? DURATIONS.filter(d => (deg.durations || []).includes(d.id)) : DURATIONS;

        const keep = new Set();
        state.duration.forEach(d => { if (allowed.some(a => a.id === d)) keep.add(d); });
        state.duration = keep;

        buildOptions(box, allowed, 'checkbox', 'stu-duration', keep);
    }

    /* ---------- grad skills, narrowed by the chosen degree ----------

       Each skill carries the degrees it is relevant to, plus "unsure" as the
       catch-all. So the checkbox list only ever offers what actually applies to
       the degree on screen, and anyone who has not committed to a degree still
       sees the whole list rather than an empty box.

       The extra-skills quick add below it is the escape hatch: anything not on
       the list for the chosen degree can still be typed in by hand. */
    function skillsFor(degreeId) {
        if (!degreeId) return SKILLS;
        return SKILLS.filter((s) => (s.degrees || []).includes(degreeId));
    }

    function refreshGradSkills() {
        const box = el('grad-skills');
        if (!box) return;
        const hint = el('grad-skills-hint');

        const allowed = skillsFor(state.degree);
        const allowedIds = new Set(allowed.map((s) => s.id));

        /* Picked skills that the new degree does not offer are dropped, so the
           blueprint never reports a skill the form is no longer showing. */
        const dropped = [...state.skills].filter((id) => !allowedIds.has(id));
        dropped.forEach((id) => state.skills.delete(id));

        buildOptions(box, allowed, 'checkbox', 'grad-skills', state.skills);

        if (hint) {
            if (!state.degree) hint.textContent = 'Pick a degree to narrow this list down.';
            else if (!allowed.length) hint.textContent = `No listed skills for that degree yet - add what you have below.`;
            else if (dropped.length) hint.textContent = `${allowed.length} skills for this degree. ${dropped.length} earlier pick${dropped.length > 1 ? 's were' : ' was'} removed.`;
            else hint.textContent = `${allowed.length} skills for this degree. Add anything missing below.`;
        }
    }

    function setStream(value) {
        state.stream = value;
        const box = el('stu-stream');
        if (box) {
            box.querySelectorAll('input').forEach(i => { i.checked = i.value === value; });
        }
        refreshDegrees();
        refreshDuration();
        syncSubmit();
    }

    /* ---------- quick-add skill chips ---------- */

    function renderChips() {
        const box = el('grad-skill-chips');
        if (!box) return;
        box.innerHTML = '';
        state.skillChips.forEach((text, i) => {
            const chip = document.createElement('span');
            chip.className = 'chip';

            const label = document.createElement('span');
            label.textContent = text;

            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'chip__x';
            x.innerHTML = '&times;';
            x.setAttribute('aria-label', `Remove ${text}`);
            x.addEventListener('click', () => {
                state.skillChips.splice(i, 1);
                renderChips();
                syncSubmit();
            });

            chip.append(label, x);
            box.append(chip);
        });
    }

    function addChip() {
        const input = el('grad-skill-quick');
        if (!input) return;
        const raw = input.value.trim();
        if (!raw) return;

        const key = normKey(raw);
        input.value = '';

        /* Typed text is matched against the known skills first, so an alias of
           something already ticked does not also show up as a separate chip. */
        const known = SKILL_BY_KEY.get(key);
        if (known && state.skills.has(known)) return;
        if (state.skills.has(key) || state.skillChips.some(c => normKey(c) === key)) return;

        state.skillChips.push(raw);
        renderChips();
        syncSubmit();
    }

    /* ---------- validation ---------- */

    function missing() {
        if (!state.path) return ['Pick a path to continue.'];
        const m = [];

        /* Only the student path asks for a stream - the grad path goes straight
           to degree, so demanding one there could never be satisfied. */
        if (state.path === 'student') {
            if (!state.stream) m.push('Pick a stream.');
            if (!state.interest.size && !state.interestOther.trim()) m.push('Pick or type at least one interest.');
            if (!state.hobby.size && !state.hobbyOther.trim()) m.push('Pick or type at least one hobby.');
            if (!state.degree) m.push('Pick a planned degree.');
            if (!state.duration.size) m.push('Pick at least one duration.');
        } else {
            if (!state.degree) m.push('Pick a degree.');
            if (!state.skills.size && !state.skillChips.length) m.push('Pick or add at least one skill.');
            if (!state.role.trim()) m.push('Type a target career role.');
        }
        return m;
    }

    function syncSubmit() {
        const btn = el('generate');
        const note = el('form-missing');
        const gaps = missing();
        if (btn) btn.disabled = gaps.length > 0;
        if (note) {
            note.textContent = gaps.length
                ? gaps.join(' ')
                : (state.path ? 'Ready. This runs entirely in your browser — nothing is sent anywhere.' : '');
        }
    }

    /* ---------- blueprint ---------- */

    function whereList(ids) {
        const ul = document.createElement('ul');
        ul.className = 'bp__where';
        (ids || []).forEach(id => {
            const r = RESOURCES[id];
            if (!r) return;
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = r.url;
            a.textContent = r.label;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            const kind = document.createElement('span');
            kind.className = 'bp__kind';
            kind.textContent = r.kind;
            li.append(a, kind);
            ul.append(li);
        });
        return ul;
    }

    function card(title, kind, body) {
        const c = document.createElement('article');
        c.className = 'bp__card';

        const head = document.createElement('header');
        head.className = 'bp__cardHead';
        const h = document.createElement('h3');
        h.textContent = title;
        const k = document.createElement('span');
        k.className = 'bp__tag';
        k.textContent = kind;
        head.append(h, k);

        c.append(head);

        [
            ['What you can do', 'what'],
            ['How to do it', 'how']
        ].forEach(([label, key]) => {
            if (!body[key]) return;
            const wrap = document.createElement('div');
            wrap.className = 'bp__part';
            const t = document.createElement('h4');
            t.className = 'bp__partLabel';
            t.textContent = label;
            const p = document.createElement('p');
            p.textContent = body[key];
            wrap.append(t, p);
            c.append(wrap);
        });

        if (body.where && body.where.length) {
            const wrap = document.createElement('div');
            wrap.className = 'bp__part';
            const t = document.createElement('h4');
            t.className = 'bp__partLabel';
            t.textContent = 'From where';
            wrap.append(t, whereList(body.where));
            c.append(wrap);
        }

        return c;
    }

    function build() {
        const head = el('bp-head');
        const cards = el('bp-cards');
        const skills = el('bp-skills');
        const skillsLede = el('bp-skills-lede');
        const timeline = el('bp-timeline');
        const timelineLede = el('bp-timeline-lede');

        head.innerHTML = '';
        cards.innerHTML = '';
        skills.innerHTML = '';
        timeline.innerHTML = '';

        /* --- which role? --- */
        const firstInterest = state.interest.size ? byId(INTERESTS, [...state.interest][0]) : null;
        const typedRole = state.role.trim();
        const matchedId = matchRole(typedRole);
        const suggestedId = firstInterest ? firstInterest.role : null;

        const roleId = typedRole ? (matchedId || suggestedId) : suggestedId;
        const role = roleId ? ROLES[roleId] : null;
        const isSuggestion = !!typedRole && !matchedId;

        const roleLabel = typedRole
            ? (role ? role.label : typedRole)
            : (role ? role.label : 'A few directions worth exploring');

        /* --- head --- */
        const tag = document.createElement('span');
        tag.className = 'bp__tag bp__tag--big';
        tag.textContent = 'Your blueprint';

        const title = document.createElement('h2');
        title.className = 'bp__role';
        title.textContent = roleLabel;

        const src = document.createElement('p');
        src.className = 'bp__roleSrc';
        if (!role) {
            src.textContent = typedRole
                ? 'We have no specific guide for that exact title, so this is the general version below.'
                : 'We could not match what you entered to one of the roles we have data for, so this is the general version below.';
        } else if (!typedRole) {
            src.textContent = 'Suggested from your first interest — it is a starting point, not a decision.';
        } else if (isSuggestion) {
            src.textContent = 'We do not have a specific guide for that exact title, so this is built from the role closest to it.';
        } else {
            src.textContent = 'The role you named.';
        }

        const blurb = document.createElement('p');
        blurb.className = 'bp__blurb';
        blurb.textContent = role ? role.blurb : GENERIC_ITEM.what;

        const meta = document.createElement('ul');
        meta.className = 'bp__meta';
        const addMeta = (label, value) => {
            if (!value) return;
            const li = document.createElement('li');
            const s = document.createElement('span');
            s.className = 'bp__metaLabel';
            s.textContent = label;
            li.append(s, document.createTextNode(value));
            meta.append(li);
        };
        const stream = byId(STREAMS, state.stream);
        addMeta('Stream', stream ? stream.label : '');
        addMeta(state.path === 'student' ? 'Planned degree' : 'Degree', (byId(DEGREES, state.degree) || {}).label || '');
        if (state.duration.size) {
            addMeta('Duration', [...state.duration].map(d => (byId(DURATIONS, d) || {}).label).filter(Boolean).join(', '));
        }
        if (state.interest.size) {
            addMeta('Interests', [...state.interest].map(i => (byId(INTERESTS, i) || {}).label).filter(Boolean).join(', '));
        }
        if (state.skills.size) {
            addMeta('Skills', [...state.skills].map(s => (byId(SKILLS, s) || {}).label).filter(Boolean).join(', '));
        }
        if (state.skillChips.length) addMeta('Added', state.skillChips.join(', '));

        head.append(tag, title, src, blurb, meta);

        /* --- cards: role first, then form order --- */
        cards.append(card(roleLabel, 'Role', role || GENERIC_ITEM));

        if (stream) cards.append(card(stream.label, 'Stream', stream));

        const deg = byId(DEGREES, state.degree);
        if (deg) cards.append(card(deg.label, state.path === 'student' ? 'Degree' : 'Degree', deg));

        [...state.duration].forEach(d => {
            const du = byId(DURATIONS, d);
            if (du) cards.append(card(du.label, 'Duration', du));
        });

        [...state.interest].forEach(i => {
            const it = byId(INTERESTS, i);
            if (it) cards.append(card(it.label, 'Interest', it));
        });
        if (state.interestOther.trim()) {
            cards.append(card(state.interestOther.trim(), 'Interest', GENERIC_ITEM));
        }

        [...state.skills].forEach(s => {
            const sk = byId(SKILLS, s);
            cards.append(card(sk ? sk.label : s, 'Skill', sk || GENERIC_ITEM));
        });
        state.skillChips.forEach(t => {
            const sk = byId(SKILLS, SKILL_BY_KEY.get(normKey(t)) || '');
            cards.append(card(sk ? sk.label : t, 'Skill (added)', sk || GENERIC_ITEM));
        });

        [...state.hobby].forEach(hh => {
            const hb = byId(HOBBIES, hh);
            if (hb) cards.append(card(hb.label, 'Hobby', hb));
        });
        if (state.hobbyOther.trim()) {
            cards.append(card(state.hobbyOther.trim(), 'Hobby', GENERIC_ITEM));
        }

        /* --- skills to add --- */
        const have = new Set(state.skills);
        state.skillChips.forEach(c => {
            const id = SKILL_BY_KEY.get(normKey(c));
            if (id) have.add(id);
        });

        const required = role ? role.requires : [];
        const gap = required.filter(r => !have.has(r));
        const unknownChips = state.skillChips.filter(c => !SKILL_BY_KEY.has(normKey(c)));

        if (required.length) {
            skillsLede.textContent = gap.length
                ? `${gap.length} of ${required.length} things this role asks for are not in your list yet.`
                : 'Your list already covers everything this role asks for.';
        } else {
            skillsLede.textContent = role
                ? 'We do not have a skill list for that exact title, so there is nothing to compare against yet.'
                : 'Nothing to compare against, because we could not match your interest to a role we have a skill list for. Pick one of the listed interests and this section fills in.';
        }

        if (gap.length) {
            const ul = document.createElement('ul');
            ul.className = 'bp__skillList';
            gap.forEach(id => {
                const sk = byId(SKILLS, id);
                if (!sk) return;
                const li = document.createElement('li');
                const h = document.createElement('h4');
                h.textContent = sk.label;
                const p = document.createElement('p');
                p.textContent = sk.what;
                li.append(h, p);
                ul.append(li);
            });
            skills.append(ul);
        }

        if (unknownChips.length) {
            const note = document.createElement('p');
            note.className = 'bp__note';
            note.textContent = 'We do not recognise ' +
                unknownChips.map(c => `"${c}"`).join(', ') +
                ' yet, so they have not been counted towards the list above.';
            skills.append(note);
        }

        /* --- timeline --- */
        const phases = role ? role.phases : GENERIC_PHASES;
        const durLabel = [...state.duration].map(d => (byId(DURATIONS, d) || {}).label).filter(Boolean);
        timelineLede.textContent = durLabel.length
            ? `Spread across the ${durLabel.join(' and ')} you picked.`
            : 'A steady pace from where you are now.';

        PHASES.forEach((ph, i) => {
            const li = document.createElement('li');
            li.className = 'bp__phase';
            const when = document.createElement('span');
            when.className = 'bp__phaseWhen';
            when.textContent = ph.label;
            const name = document.createElement('span');
            name.className = 'bp__phaseName';
            name.textContent = ph.name;
            const p = document.createElement('p');
            p.textContent = phases[i] || '';
            li.append(when, name, p);
            timeline.append(li);
        });

    bp.hidden = false;
    bp.scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* Blueprint entrance: head, then the selection cards cascade in, then the
       skills gap, then the timeline. #bp-cards is deliberately NOT animated
       itself - only its .bp__card children - so opacity is not compounded. */
    if (MOTION.ok) {
        const ease = { duration: 0.8, ease: 'expo.out', clearProps: 'transform,opacity' };
        const cards = bp.querySelectorAll('.bp__card');

        const tl = gsap.timeline();
        tl.from(bp.querySelector('#bp-head'), { y: 34, opacity: 0, ...ease });
        if (cards.length) {
            tl.from(cards, { y: 40, opacity: 0, ...ease, stagger: 0.07 }, '-=0.45');
        }
        tl.from(bp.querySelector('#bp-skills'), { y: 34, opacity: 0, ...ease }, '-=0.4');
        tl.from(bp.querySelector('#bp-timeline'), { y: 34, opacity: 0, ...ease }, '-=0.55');
    }
    }

    /* ---------- events ---------- */

    form.addEventListener('change', (e) => {
        const t = e.target;
        if (!t.name) return;

        switch (t.name) {
            case 'path':
                state.path = t.value;
                el('group-student').hidden = t.value !== 'student';
                el('group-grad').hidden = t.value !== 'grad';
                /* Both degree selects have to be rebuilt here. The student one
                   is stream-filtered and the grad one lists every degree, and
                   neither gets touched until the path is actually chosen. */
                refreshDegrees();
                refreshDuration();
                /* state.degree carries across a path switch, so the grad skill
                   list has to be re-filtered for whatever is now selected. */
                refreshGradSkills();
                break;
            case 'stu-stream':
                setStream(t.value);
                break;
            case 'stu-interest':
                t.checked ? state.interest.add(t.value) : state.interest.delete(t.value);
                break;
            case 'stu-hobbies':
                t.checked ? state.hobby.add(t.value) : state.hobby.delete(t.value);
                break;
            case 'stu-duration':
                t.checked ? state.duration.add(t.value) : state.duration.delete(t.value);
                break;
            case 'grad-skills':
                t.checked ? state.skills.add(t.value) : state.skills.delete(t.value);
                break;
        }
        syncSubmit();
    });

    /* degree selects */
    ['stu-degree', 'grad-degree'].forEach(id => {
        const sel = el(id);
        if (!sel) return;
        sel.addEventListener('change', () => {
            state.degree = sel.value;
            refreshDuration();
            /* The grad skill list is built from the degree, so it has to be
               rebuilt whenever the degree changes. Harmless on the student
               path - that select is never visible there. */
            refreshGradSkills();
            syncSubmit();
        });
    });

    ['stu-interest-other', 'stu-hobby-other', 'grad-role'].forEach(id => {
        const input = el(id);
        if (!input) return;
        input.addEventListener('input', () => {
            if (id === 'stu-interest-other') state.interestOther = input.value;
            if (id === 'stu-hobby-other') state.hobbyOther = input.value;
            if (id === 'grad-role') state.role = input.value;
            syncSubmit();
        });
    });

    const quick = el('grad-skill-quick');
    if (quick) quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } });
    const addBtn = el('grad-skill-add');
    if (addBtn) addBtn.addEventListener('click', addChip);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (missing().length) return;
        build();
    });

    /* ---------- start over ---------- */

    function reset() {
        form.reset();
        Object.assign(state, {
            path: '', stream: '', interestOther: '', hobbyOther: '',
            degree: '', role: ''
        });
        state.interest.clear();
        state.hobby.clear();
        state.duration.clear();
        state.skills.clear();
        state.skillChips = [];

        el('group-student').hidden = true;
        el('group-grad').hidden = true;
        el('stu-degree').value = '';
        el('grad-degree').value = '';

        ['stu-interest-other', 'stu-hobby-other', 'grad-role', 'grad-skill-quick'].forEach(id => {
            if (el(id)) el(id).value = '';
        });

        renderChips();

        /* state.path is '' again, so refreshDegrees() only rebuilds the student
           select. Reset the grad one too or a stale degree would survive a
           "start over". */
        const savedPath = state.path;
        state.path = 'grad';
        refreshDegrees();
        state.path = savedPath;
        refreshDegrees();
        refreshDuration();
        refreshGradSkills();
        syncSubmit();
        bp.hidden = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const restart = el('bp-restart');
    if (restart) restart.addEventListener('click', reset);

    const print = el('bp-print');
    if (print) print.addEventListener('click', () => window.print());

    /* ---------- boot ---------- */

    refreshDegrees();
    refreshDuration();
    refreshGradSkills();
    syncSubmit();
}

function initFooter() {
    const year = document.getElementById("year");
    if (year) year.textContent = new Date().getFullYear();
}

/* Every label in the profile dialog is written on every open, because the dialog
   has two subjects and the headings change between them. This is the one place
   that does it: a heading left holding the other subject's wording is how a popup
   ends up saying "Your data" above somebody else's interests. */
function setText(node, text) {
    if (node) node.textContent = text;
}

/* Copy that only makes sense for your own account, kept out of the paint function
   so the two subjects' text can be compared side by side. */
const OWN_FOLLOWERS_NOTE = "No one follows you yet, and that number is honest rather than " +
    "broken. Accounts and follows live in this browser only, with no shared server, so " +
    "nobody else's follow can reach your profile. Your following list above is real.";
const OWN_TAGS_EMPTY = "Pick interests and skills on the Community page and they show up here.";

/* A member's follower count is served data and is shown as it stands. It is read in
   exactly one place, and never off the account record: an account has no follower
   data to derive, so borrowing a member's number there would be a different lie. */
function followerCount(member) {
    const n = Number(member && member.followers);
    return isFinite(n) && n > 0 ? n : 0;
}

/* ---------- profile popup ----------
   One dialog, two subjects. Your own account opens from the chip in the navbar, so
   it is on every page that has a navbar. A member's opens when their name is
   clicked on a suggestion card, and shows the same sections for the same reasons:
   who they are, what they are into, who follows them and which groups they are in.
   It answers four questions about you - who am I, what have I picked, who do I
   follow, and which groups am I in.

   Followers is the odd one out and deliberately so. An account here is an email
   and a password hash in this browser, and nothing ever links one account to a
   member card, so no other person's follow can be attributed to you - there is
   no honest way to produce a number. Rather than invent one or borrow a
   stranger's, your own count is a real 0 and the copy next to it says why. A
   member's is the opposite case: the member list carries a real count, so their
   row shows it. If a shared backend ever lands, the zero is the single line to
   replace. */
function initProfile() {
    const dialog = document.getElementById("profile-dialog");
    const openBtns = Array.from(document.querySelectorAll("[data-profile-open]"));

    /* career.html has neither a navbar nor this dialog, and community.html's chip
       is the same markup as the other two pages */
    if (!dialog || !openBtns.length) return;

    const el = {};
    ["initial", "email", "role", "blurb", "title",
        "following-count", "followers-count", "group-count", "group-hint",
        "following-label", "followers-label", "groups-label",
        "data-title", "following-title", "followers-title", "followers-note",
        "tags", "tags-empty", "following", "following-empty",
        "groups", "groups-empty"].forEach((key) => {
        el[key] = dialog.querySelector("[data-profile-" + key + "]");
    });
    const closeBtn = dialog.querySelector("[data-profile-close]");
    const chipName = document.querySelector("[data-profile-chipname]");

    const session = () => readStore(AUTH_SESSION, {}) || {};

    const record = () => userRecord(session().email);

    const followIds = () => {
        const s = session();
        const list = s.email ? readStore(FOLLOWS_KEY + s.email, []) : [];
        return Array.isArray(list) ? list : [];
    };

    /* groups come from the registry, member names from the people list so a
       follow id resolves to somebody rather than a slug */
    let registry = [];
    let members = {};
    /* who is in each group, by name. Built here from the people list rather than
       taken from a field on the registry, because the registry's `members` is a
       count: a count answers "how many" and the question is "who". */
    let roster = {};
    let label = { interests: {}, skills: {}, groups: {} };
    let asked = false;

    /* ---------- whose profile is on screen ----------
       `viewing` is "" for your own account and a member id for somebody else's.
       It is the only thing that decides which of the two paints runs, so the two
       can never be half-applied to each other: every slot below is written on
       every open, by one paint or the other.

       `opened` is the record the click carried. The member list may not have been
       fetched on this page at all - the home page has no suggestion slide - so the
       click hands over what it already has and the fetch below replaces it with
       the same record plus the label lookups. */
    let viewing = "";
    let opened = null;

    const getJSON = (url) => fetch(url).then((res) => {
        if (!res.ok) throw new Error(url + " said " + res.status);
        return res.json();
    });

    /* Lazy and once-per-session: the popup is behind a click, and the people
       payload is the one the profile does not need until then. A failure clears
       `asked` so reopening retries rather than living with a half-built popup. */
    const load = () => {
        if (asked) return Promise.resolve();

        asked = true;
        return Promise.all([getJSON("/api/groups"), getJSON("/api/people")])
            .then(([g, p]) => {
                registry = g.groups || [];
                label.groups = {};
                registry.forEach((row) => { label.groups[row.id] = row.label; });

                members = {};
                roster = {};
                (p.people || []).forEach((m) => {
                    members[m.id] = m;
                    /* every group this person is listed in collects their name, so
                       the roster is a by-product of the one list we already have */
                    (Array.isArray(m.groups) ? m.groups : []).forEach((gid) => {
                        if (!roster[gid]) roster[gid] = [];
                        roster[gid].push(String(m.name || m.handle || m.id));
                    });
                });

                label.interests = {};
                (p.interests || []).forEach((row) => { label.interests[row.id] = row.label; });
                label.skills = {};
                (p.skills || []).forEach((row) => { label.skills[row.id] = row.label; });
            })
            .catch((err) => {
                asked = false;
                throw err;
            });
    };

    const groupLabel = (id) => label.groups[id] || id;

    /* an id the vocabulary has not loaded yet falls back to the id, which is the
       slug people.json already uses ("python", "ai") rather than a blank. The
       repaint after the fetch replaces it with the real label. */
    const tagLabel = (kind, id) => label[kind][id] || id;

    const myPicks = () => {
        const picks = readStore(PROFILE_KEY, {}) || {};
        const asList = (v) => (Array.isArray(v) ? v : []);
        return asList(picks.interests).concat(asList(picks.skills));
    };

    /* interests carry no marker class - the plain chip is the interest look, and
       only the second kind needs telling apart. Both subjects use this, so the
       chip is defined once rather than twice and drifting. */
    const paintTags = (rows) => {
        if (!el.tags) return;

        el.tags.innerHTML = rows.map((row) =>
            '<li' + (row.kind === "Skill" ? ' class="is-skill"' : "") +
            ' title="' + esc(row.kind) + '">' + esc(row.text) + "</li>").join("");

        if (el["tags-empty"]) el["tags-empty"].hidden = rows.length > 0;
    };

    const pickedTags = () => {
        const picks = readStore(PROFILE_KEY, {}) || {};
        const asList = (v) => (Array.isArray(v) ? v : []);
        /* interests carry no marker class - the plain chip is the interest
           look, and only the second kind needs telling apart */
        return asList(picks.interests)
            .map((id) => ({ text: tagLabel("interests", id), kind: "Interest" }))
            .concat(asList(picks.skills).map((id) => ({
                text: tagLabel("skills", id), kind: "Skill",
            })));
    };

    const paintFollowing = () => {
        const ids = followIds();

        if (el["following-count"]) el["following-count"].textContent = ids.length;
        if (el.following) {
            el.following.innerHTML = ids.map((id) => {
                const m = members[id];
                return "<li><b>" + esc(m ? m.name : id) + "</b>" +
                    '<span class="prof__listsub">' +
                    esc(m ? m.handle || "" : "unavailable") + "</span></li>";
            }).join("");
        }
        if (el["following-empty"]) el["following-empty"].hidden = ids.length > 0;
    };

    const paintGroups = () => {
        const mine = myGroups();

        if (el["group-count"]) el["group-count"].textContent = mine.length;
        paintGroupList(mine, true);
    };

    /* the group list is the same shape either way - only the source of the ids
       differs, yours from the account record and theirs from the member list.
       `withRoster` is the one difference in content: your groups carry the names of
       who is in them, because you are in them and would want to know. A member's
       panel answers "which groups is this person in", and listing the other people
       in each of those would bury that answer under a roll call. */
    const paintGroupList = (ids, withRoster) => {
        if (el.groups) {
            el.groups.innerHTML = ids.map((id) => {
                const row = registry.filter((g) => g.id === id)[0];
                /* every name, not the first three and a count: a group here holds
                   between two and seven people, so there is nothing to truncate,
                   and "and 2 more" would be a worse answer than the whole list */
                const here = withRoster ? roster[id] : null;
                return "<li><b>" + esc(groupLabel(id)) + "</b>" +
                    (row && row.blurb
                        ? '<span class="prof__listsub">' + esc(row.members) + " members</span>"
                        : "") +
                    /* nothing at all when the people list never arrived: the hint
                       beside the heading already says the backend is offline, and a
                       second line admitting the same thing per group is noise. An
                       empty roster would be worse - it reads as "nobody is here" */
                    (here && here.length
                        ? '<span class="prof__roster">' + esc(here.join(", ")) + "</span>"
                        : "") +
                    "</li>";
            }).join("");
        }
        if (el["groups-empty"]) el["groups-empty"].hidden = ids.length > 0;
    };

    /* ---------- the two subjects share one set of slots ----------
       Every heading, note and member-only element is written here, before either
       subject puts its numbers in. Whatever is not being shown has to be cleared
       rather than left holding the other one's words: a dialog that said "Your
       data" above a stranger's interests, or offered an Edit button over somebody
       else's name, would be worse than an empty one. Doing it in one place is also
       what makes the third path - an id nothing answers to - able to reset the
       dialog without repeating any of it. */
    const resetSubject = () => {
        if (el.role) el.role.hidden = true;
        if (el.blurb) el.blurb.hidden = true;
        if (editBtn) editBtn.hidden = true;
        if (editForm) editForm.hidden = true;
        if (el["group-hint"]) el["group-hint"].textContent = "";

        /* the two labels that mean the same thing for both subjects, and the two
           that do not, which each paint sets for itself */
        setText(el["followers-label"], "Followers");
        setText(el["groups-label"], "Groups");
        setText(el["followers-title"], "Followers");
    };

    /* ---------- your own profile ---------- */
    const paintOwn = () => {
        const s = session();
        const me = record();
        const name = String(me.name || s.name || "").trim();
        const email = me.email || s.email || "";

        const seed = (name || email || "F").trim();
        if (el.initial) el.initial.textContent = seed.charAt(0).toUpperCase();
        /* the heading is put back as markup rather than as text: a member's name
           is written into this same element, so switching subjects has to restore
           the <em> as well as the words */
        if (el.title) el.title.innerHTML = "Your <em>profile</em>";
        if (el.email) el.email.textContent = email;
        /* only this subject touches the navbar chip. Reading somebody else's
           profile must not rename the button that opens yours. */
        if (chipName) chipName.textContent = name || email || "Profile";

        /* the editor only ever appears over your own record */
        if (editBtn) editBtn.hidden = false;
        resetSubject();

        setText(el["following-label"], "Following");
        setText(el["following-title"], "Following");
        setText(el["data-title"], "Your data");
        if (el["followers-note"]) el["followers-note"].textContent = OWN_FOLLOWERS_NOTE;
        if (el["tags-empty"]) el["tags-empty"].textContent = OWN_TAGS_EMPTY;
        if (el["following-empty"]) {
            el["following-empty"].textContent = "You are not following anyone yet. " +
                "Find people on the Community page.";
        }
        if (el["groups-empty"]) {
            el["groups-empty"].textContent = "You are not in any groups yet. Join one " +
                "from the Groups section on the Community page and it is saved to your account.";
        }

        /* There is no server to attribute another account's follow to, so this is
           a real zero rather than a placeholder for one. */
        if (el["followers-count"]) el["followers-count"].textContent = "0";

        paintTags(pickedTags());
        paintFollowing();
        paintGroups();
    };

    /* ---------- somebody else's profile ----------
       Every number here is served data rather than something derived from this
       browser, which is why the three rows can all be real. The first one is your
       overlap with them rather than a list you can edit, so the panel underneath
       it becomes the tags themselves. */
    const paintMember = (m) => {
        const name = String(m.name || m.handle || m.id || "").trim();
        const groups = Array.isArray(m.groups) ? m.groups : [];
        const match = m.match || {};
        const shared = (match.interests || []).concat(match.skills || []);
        const asList = (v) => (Array.isArray(v) ? v : []);

        const seed = (name || "F").trim();
        if (el.initial) el.initial.textContent = seed.charAt(0).toUpperCase();
        if (el.title) el.title.textContent = name;
        /* a member has no address on this site, and their handle is the closest
           thing to one - so it takes the slot your email would occupy */
        if (el.email) el.email.textContent = m.handle || "";

        resetSubject();

        if (el.role) {
            el.role.textContent = m.roleLabel || "";
            el.role.hidden = !m.roleLabel;
        }
        if (el.blurb) {
            el.blurb.textContent = m.blurb || "";
            el.blurb.hidden = !m.blurb;
        }

        setText(el["following-label"], "In common");
        setText(el["following-title"], "In common with you");
        setText(el["data-title"], "Interests and skills");
        if (el["followers-note"]) {
            el["followers-note"].textContent = "This is the follower count the member " +
                "list carries, so it is real. Who they follow is not recorded " +
                "anywhere, so there is no honest number to put under that.";
        }
        if (el["tags-empty"]) {
            el["tags-empty"].textContent = "This member has no interests or skills listed.";
        }
        if (el["groups-empty"]) {
            el["groups-empty"].textContent = "This member is not listed in any group.";
        }

        if (el["following-count"]) el["following-count"].textContent = shared.length;
        if (el["followers-count"]) el["followers-count"].textContent = followerCount(m);
        if (el["group-count"]) el["group-count"].textContent = groups.length;

        paintTags(
            asList(m.interests).map((id) => ({ text: tagLabel("interests", id), kind: "Interest" }))
                .concat(asList(m.skills).map((id) => ({
                    text: tagLabel("skills", id), kind: "Skill",
                })))
        );

        /* the shared tags go in the panel the first tab opens, reusing the list
           element rather than adding a second one that is only ever on screen in
           one of the two modes */
        if (el.following) {
            el.following.innerHTML = shared.map((id) => {
                const isSkill = asList(m.skills).indexOf(id) > -1;
                return "<li><b>" + esc(tagLabel(isSkill ? "skills" : "interests", id)) + "</b>" +
                    '<span class="prof__listsub">' + (isSkill ? "Skill" : "Interest") +
                    "</span></li>";
            }).join("");
        }
        if (el["following-empty"]) {
            el["following-empty"].hidden = shared.length > 0;
            el["following-empty"].textContent = myPicks().length
                ? "Nothing in common yet - same direction, different toolkits."
                : "Pick a few tags on the Community page and this will say what the two of you share.";
        }

        paintGroupList(groups, false);
    };

    /* An id nothing in the member list answers to: the record never arrived, so
       there is no profile to paint. The dialog is reset rather than left holding
       the last subject, and says what happened instead of showing an empty card. */
    const paintUnknown = () => {
        resetSubject();

        if (el.initial) el.initial.textContent = "?";
        if (el.title) el.title.textContent = "Member not found";
        if (el.email) el.email.textContent = "";
        setText(el["following-label"], "In common");
        setText(el["data-title"], "Interests and skills");
        if (el["followers-count"]) el["followers-count"].textContent = "0";
        if (el["following-count"]) el["following-count"].textContent = "0";
        if (el["group-count"]) el["group-count"].textContent = "0";
    };

    const paint = () => {
        /* the member list wins over whatever the click carried: it is the same
           record plus the label lookups, and it has been checked against the id */
        const m = viewing ? members[viewing] || opened : null;

        /* a stale panel would show the last subject's list under the new heading,
           so the accordion collapses on every repaint rather than on close only */
        closeAllPanels();

        if (viewing && !m) {
            paintUnknown();
            return;
        }

        if (m) paintMember(m);
        else paintOwn();
    };

    /* ---------- profile edit ----------
       The edit form lives in the same dialog, hidden until the user presses Edit.
       Saving requires the current password (so a hijacked session cannot change the
       account), validates the new email against the registry, hashes any new password,
       and migrates the follows key if the email changes. The session is updated so
       the navbar chip and the profile itself reflect the new name/email immediately. */
    const editBtn = dialog.querySelector("[data-profile-edit]");
    const editForm = dialog.querySelector("[data-profile-edit-form]");
    const editName = dialog.querySelector("#prof-edit-name");
    const editEmail = dialog.querySelector("#prof-edit-email");
    const editPassCurrent = dialog.querySelector("#prof-edit-pass-current");
    const editPassNew = dialog.querySelector("#prof-edit-pass-new");
    const editPassConfirm = dialog.querySelector("#prof-edit-pass-confirm");
    const editSave = dialog.querySelector("[data-profile-edit-save]");
    const editCancel = dialog.querySelector("[data-profile-edit-cancel]");
    const editMsg = dialog.querySelector("[data-profile-edit-msg]");

    let editing = false;

    const showEditMsg = (text, ok) => {
        if (!editMsg) return;
        editMsg.textContent = text;
        editMsg.classList.toggle("prof__msg--ok", !!ok);
    };

    const clearEditMsg = () => { if (editMsg) editMsg.textContent = ""; };

    const enterEdit = () => {
        const me = record();
        const s = session();
        if (!me.email) return;

        editing = true;
        if (editName) editName.value = me.name || "";
        if (editEmail) editEmail.value = me.email || "";
        if (editPassCurrent) editPassCurrent.value = "";
        if (editPassNew) editPassNew.value = "";
        if (editPassConfirm) editPassConfirm.value = "";
        clearEditMsg();

        if (editForm) editForm.hidden = false;
        if (editBtn) editBtn.textContent = "Editing…";
        if (editBtn) editBtn.disabled = true;
    };

    const exitEdit = () => {
        editing = false;
        if (editForm) editForm.hidden = true;
        if (editBtn) editBtn.textContent = "Edit";
        if (editBtn) editBtn.disabled = false;
        clearEditMsg();
    };

    const saveEdit = () => {
        const me = record();
        const s = session();
        if (!me.email) return;

        const name = editName ? editName.value.trim() : "";
        const email = editEmail ? editEmail.value.trim().toLowerCase() : "";
        const passCurrent = editPassCurrent ? editPassCurrent.value : "";
        const passNew = editPassNew ? editPassNew.value : "";
        const passConfirm = editPassConfirm ? editPassConfirm.value : "";

        if (!passCurrent) { showEditMsg("Current password is required."); return; }
        if (email && !looksLikeEmail(email)) { showEditMsg("Enter a valid email."); return; }
        if (passNew && passNew.length < 6) { showEditMsg("New password must be at least 6 characters."); return; }
        if (passNew && passNew !== passConfirm) { showEditMsg("New passwords do not match."); return; }
        if (!name && !email && !passNew) { showEditMsg("Nothing to change."); return; }

        digest(s.email + "::" + passCurrent).then((hash) => {
            if (hash !== me.hash) { showEditMsg("Current password is incorrect."); return; }

            const users = readStore(AUTH_USERS, {}) || {};
            const oldEmail = me.email;
            const newEmail = email || oldEmail;

            if (newEmail !== oldEmail && users[newEmail]) {
                showEditMsg("That email is already in use.");
                return;
            }

            const next = { ...me, name: name || me.name, email: newEmail };
            if (passNew) next.hash = digest(newEmail + "::" + passNew);

            delete users[oldEmail];
            users[newEmail] = next;
            writeStore(AUTH_USERS, users);

            if (newEmail !== oldEmail) {
                const follows = readStore(FOLLOWS_KEY + oldEmail, []);
                if (follows.length) {
                    writeStore(FOLLOWS_KEY + newEmail, follows);
                    writeStore(FOLLOWS_KEY + oldEmail, []);
                }
            }

            const newSession = { ...s, name: next.name, email: next.email };
            writeStore(AUTH_SESSION, newSession);

            exitEdit();
            paint();
            showProfileError(new Error("Profile updated"));
        });
    };

    if (editBtn) editBtn.addEventListener("click", enterEdit);
    if (editCancel) editCancel.addEventListener("click", exitEdit);
    if (editSave) editSave.addEventListener("click", saveEdit);

    const close = () => {
        if (dialog.open && typeof dialog.close === "function") dialog.close();
    };

    const open = () => {
        /* Your own profile is unreachable signed out - the chip is inside
           .auth__who, and there would be no account to describe. A member's is
           public, so the guard is lifted for them: a visitor who is not signed in
           can still read who somebody is. */
        if (!viewing && !session().email) return;

        if (typeof dialog.showModal === "function") {
            if (!dialog.open) dialog.showModal();
        }

        const links = document.getElementById("nav-links");
        const toggle = document.getElementById("nav-toggle");
        if (links) links.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");

        paint();
        load()
            .then(() => { paint(); })
            .catch((err) => {
                /* the popup still opens with whatever is in storage: a name, the
                   follows that were saved, the groups already joined. The names of
                   those groups are the only thing the lookups were for, so without
                   them the list falls back to raw ids - which is why the hint
                   says so rather than the popup pretending it is complete. */
                if (el["group-hint"]) {
                    el["group-hint"].textContent = "group names unavailable - backend offline";
                }
                showProfileError(err);
            });
    };

    const openOwn = () => {
        /* the chip is the only way back to your own profile once you have opened
           somebody else's, and it has to say which subject it is asking for or
           the click would land on whoever was last looked at */
        viewing = "";
        opened = null;
        open();
    };

    const openMember = (e) => {
        const detail = (e && e.detail) || {};
        const id = String(detail.id || "");

        /* The id arrives on a window event, which anything on the page could
           raise, so it is only used to look a member up and the record has to
           agree with it. A record for a different member is thrown away rather
           than painted under the wrong name. */
        if (!id) return;

        viewing = id;
        opened = detail.person && detail.person.id === id ? detail.person : null;
        open();
    };

    openBtns.forEach((btn) => btn.addEventListener("click", openOwn));
    window.addEventListener("future-era:open-member", openMember);
    if (closeBtn) closeBtn.addEventListener("click", close);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });

    /* Signing out must not leave the popup on screen showing the last account's
       name, and the chip label has to follow the session too. A member's profile
       is dropped as well: the session change is about your account, and the popup
       has one subject at a time - leaving it on a stranger would be a profile you
       signed out of that still had your following list behind it. */
    window.addEventListener("future-era:session", () => {
        viewing = "";
        opened = null;
        if (!session().email) close();
        else paint();
    });

    /* This popup no longer changes the group list - joining happens on the
       Community page, where each group can say why it is being suggested. But it
       still *shows* that list, so it has to follow changes made elsewhere. Without
       this it would sit on whatever it painted when it was last opened, which is
       a stale number in a dialog that is meant to be the summary of your account. */
    window.addEventListener("future-era:groups-changed", () => {
        /* a member's groups come from the member list, not from your account, so
           a join made elsewhere has nothing to say about them */
        if (session().email && !viewing) paint();
    });

    /* ---------- stat-tab accordion (Instagram-style) ----------
       Clicking Following / Followers / Groups on the stat bar expands the
       matching panel directly below the stat row.  Clicking the same tab again
       collapses it.  Only one panel is open at a time.
       The three headings are the same three either way round - your first panel
       is who you follow, a member's is what you have in common with them - so
       the tabs open the panels in the order they are written.
       NOTE: we never set hidden=true after first reveal — overflow:hidden in CSS
       does the visual hiding via max-height:0, avoiding the transitionend race. */
    const statBtns = Array.from(dialog.querySelectorAll("[data-profile-tab]"));
    const panels   = Array.from(dialog.querySelectorAll("[data-profile-panel]"));

    /* Also puts the panel back out of the a11y tree. A panel left un-hidden at
       max-height 0 is invisible but still readable, and paint() calls this on
       every repaint - so switching between your profile and a member's cannot
       leave the last subject's list behind for a screen reader. */
    const closeAllPanels = () => {
        statBtns.forEach((b) => b.setAttribute("aria-expanded", "false"));
        panels.forEach((p) => {
            p.style.maxHeight = "0px";
            p.style.opacity   = "0";
            p.hidden = true;
        });
    };

    statBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const key    = btn.dataset.profileTab;
            const panel  = dialog.querySelector("[data-profile-panel=\"" + key + "\"]");
            const isOpen = btn.getAttribute("aria-expanded") === "true";

            closeAllPanels();

            if (!isOpen && panel) {
                /* strip hidden so the element participates in layout */
                panel.hidden = false;
                /* double rAF so the browser has painted the unhidden state
                   before we animate from max-height:0 */
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        panel.style.maxHeight = panel.scrollHeight + "px";
                        panel.style.opacity   = "1";
                    });
                });
                btn.setAttribute("aria-expanded", "true");
            }
        });
    });

    /* reset panels when dialog closes so they start hidden next open */
    dialog.addEventListener("close", () => { closeAllPanels(); });
}

function showProfileError(err) {
    /* the popup has no dedicated error line, and it is still usable without the
       two lookups, so this stays in the console rather than inventing markup */
    if (window.console && console.warn) console.warn("[profile]", err);
}

/* ---------- community group suggestions ----------
   Sits under the member slide on the community page. Same picks, same response,
   same scoring rule as the slide - a group is scored on the tags of everyone in
   it, so "people like you are in here" is a number the server worked out rather
   than a guess made here.

   Joining is entirely optional and reversible, and nothing happens until you
   press Join. It is also local: the membership is written to your account record
   in this browser, exactly as a follow is, because there is still no write
   endpoint to put it in. */
function initCommunityGroups() {
    const list = document.getElementById("groups-list");
    const status = document.getElementById("groups-status");
    if (!list) return;

    let rows = [];
    let label = { interests: {}, skills: {} };

    const tagText = (ids, kind) => ids
        .map((id) => label[kind][id] || id)
        .join(", ");

    const render = () => {
        const mine = myGroups();

        list.innerHTML = rows.map((g) => {
            const on = mine.indexOf(g.id) > -1;
            const m = g.match || {};
            const shared = []
                .concat(m.interests ? tagText(m.interests, "interests") : [])
                .concat(m.skills ? tagText(m.skills, "skills") : [])
                .filter(Boolean);

            const why = shared.length
                ? "You have " + esc(shared.join(", ")) + " in common here"
                : m.score === null || m.score === undefined
                    ? "Pick your tags above and this will be ranked for you"
                    : "Nothing in common yet, but it is a lively group";

            /* Only the first few names are worth the line, and the card is laid
               out for three. The server caps this too, but a layout should not
               depend on an upstream limit staying where it is, so the cap is
               applied here and "and more" is judged against what was shown. */
            const named = (g.names || []).slice(0, 3);
            const who = g.matches
                ? '<p class="group__who">' + esc(g.matches) + " of " + esc(g.members) +
                    " people here match you" +
                    (named.length
                        ? " - " + esc(named.join(", ")) +
                          (g.matches > named.length ? " and more" : "")
                        : "") + "</p>"
                : '<p class="group__who">' + esc(g.members) + " people, none of them picked yet</p>";

            return '<li class="group' + (on ? " is-joined" : "") + '" data-group="' + esc(g.id) + '">' +
                '<div class="group__body">' +
                '<div class="group__top">' +
                /* The chat lives on the group's own name, because that is what
                   people look for - a separate "Open chat" line was one more
                   thing to read before arriving. Still a real link to a real
                   page, so it can be middle-clicked, copied, or opened in a new
                   tab, and rel="noopener" keeps the chat page from reaching back
                   through window.opener into this one. */
                '<h3 class="group__name"><a class="group__chat" href="group.html?g=' +
                encodeURIComponent(g.id) + '" target="_blank" rel="noopener">' +
                esc(g.label) + "</a></h3>" +
                '<span class="group__score"' + (m.score === null || m.score === undefined ? ' data-unranked="true"' : "") +
                ">" + (m.score === null || m.score === undefined ? "not ranked" : m.score + "%") + "</span>" +
                "</div>" +
                '<p class="group__blurb">' + esc(g.blurb) + "</p>" +
                '<p class="group__why">' + why + "</p>" +
                who +
                "</div>" +
                '<button class="group__join" type="button" data-group-join="' + esc(g.id) + '"' +
                ' aria-pressed="' + (on ? "true" : "false") + '">' +
                (on ? "Joined" : "Join") + "</button></li>";
        }).join("");
    };

    const flipJoin = (id) => {
        /* Only ever join a group this page was actually sent. The id comes off a
           button in the DOM, and the list it lands in is stored on the account,
           so an unrecognised one would sit there forever as a slug with no label
           and nothing to undo it with. */
        if (!rows.some((g) => g.id === id)) return;

        if (!sessionOf().email) {
            /* nobody signed in, and a group joined to nobody is not a membership
               - ask for an account, the same way a follow does */
            window.dispatchEvent(new CustomEvent("future-era:open-auth"));
            return;
        }

        const mine = myGroups();
        const at = mine.indexOf(id);
        const joining = at === -1;
        const next = joining ? mine.concat([id]) : mine.filter((g) => g !== id);

        setMyGroups(next);
    };

    const onRanked = (e) => {
        const data = e.detail || RANKED;
        if (!data) return;

        rows = data.groups || [];
        label = {
            interests: Object.fromEntries((data.interests || []).map((t) => [t.id, t.label])),
            skills: Object.fromEntries((data.skills || []).map((t) => [t.id, t.label])),
        };

        if (status) {
            const picked = (data.mine && (data.mine.interests.length + data.mine.skills.length)) || 0;
            status.textContent = picked
                ? rows.length + " groups, ranked by what you picked."
                : "Pick your interests or skills above and these get ranked for you. Joining is optional.";
        }

        render();
    };

    list.addEventListener("click", (e) => {
        const button = e.target.closest("[data-group-join]");
        if (button) flipJoin(button.dataset.groupJoin);
    });

    /* the list is a view of your membership, so it has to follow the account
       and follow anything else that changes it - signing in, signing out, or
       ticking a box in the profile popup */
    window.addEventListener("future-era:session", render);
    window.addEventListener("future-era:groups-changed", render);
    window.addEventListener("future-era:ranked", onRanked);

    /* the slide announces its payload after this runs, so catch up on it if it
       has already arrived rather than waiting for the next pick */
    if (RANKED) onRanked({ detail: RANKED });
};

/* ---------- group chat ----------
   One chat per group, opened from the card on the community page.

   Messages and their images live in IndexedDB rather than localStorage, for one
   concrete reason: a single phone photo as a base64 data URL runs 1-3MB, and
   localStorage has roughly 5MB for the entire origin. Four pictures would fill
   it and every later write would throw QuotaExceededError, so the honest options
   were a database that stores Blobs natively or no images at all. IndexedDB
   also gets a large share of the disk rather than a fixed 5MB.

   The consequence is the one that follows and group membership have, and it is
   worth being blunt about: this is per-browser. Nobody else can read what you
   write here, and clearing site data deletes it. There is no write endpoint to
   put a message in, exactly as there is none for a follow. */

const CHAT_DB_NAME = "future-era-chat";
const CHAT_DB_VERSION = 1;
const CHAT_MAX_TEXT = 800;
const CHAT_MAX_BYTES = 2 * 1024 * 1024;
const CHAT_MAX_EDGE = 1200;

/* Checked against the bytes in the file, not against what the browser claims.
   SVG is deliberately absent: it can carry script, and a blob URL of one is
   same-origin content. */
const CHAT_IMAGE_TYPES = {
    "image/jpeg": true,
    "image/png": true,
    "image/gif": true,
    "image/webp": true,
};

const chatUid = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);

const chatMb = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + "MB";

function chatOpenDb() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("This browser has no IndexedDB, so there is nowhere to keep a chat history"));
            return;
        }

        let req;
        try {
            req = window.indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
        } catch (err) {
            reject(err);
            return;
        }

        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("messages")) {
                const store = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
                store.createIndex("group", "group", { unique: false });
            }
            if (!db.objectStoreNames.contains("images")) {
                db.createObjectStore("images", { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        /* Private browsing in some engines reports success and then throws on the
           first write, so the failure is caught again at the write rather than
           only here. */
        req.onerror = () => reject(req.error || new Error("chat storage could not be opened"));
        req.onblocked = () => reject(new Error("chat storage is open in another tab"));
    });
}

/* One transaction for the message and its image, or neither. A message that
   points at an image that was never stored would render as a broken box. */
function chatStoreMessage(db, record, image) {
    return new Promise((resolve, reject) => {
        const stores = image ? ["messages", "images"] : "messages";
        const tx = db.transaction(stores, "readwrite");

        if (image) {
            record.imageId = "img-" + chatUid();
            tx.objectStore("images").put({
                id: record.imageId,
                blob: image.blob,
                type: image.type,
                bytes: image.blob.size,
            });
        }

        const req = tx.objectStore("messages").add(record);
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error || new Error("the message was not saved"));
        tx.onabort = () => reject(tx.error || new Error("the message was not saved"));
    });
}

/* The index returns in key order, which is insertion order, so this is oldest
   first without a sort. */
function chatListMessages(db, group) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction("messages", "readonly");
        const req = tx.objectStore("messages").index("group").getAll(group);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error("the conversation could not be read"));
    });
}

function chatGetImage(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const req = tx.objectStore("images").get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error("the image could not be read"));
    });
}

/* The first dozen bytes, which is where every one of these four formats states
   what it is. Reading the declared type instead would mean trusting a value the
   uploader chose. */
function chatSniffImage(file) {
    return file.slice(0, 12).arrayBuffer().then((buf) => {
        const b = new Uint8Array(buf);
        const starts = (sig) => sig.every((v, i) => b[i] === v);
        const ascii = (from, len) => String.fromCharCode.apply(null, Array.prototype.slice.call(b, from, from + len));

        if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
        if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
        if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
        if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
        return null;
    });
}

function chatDecodeViaImg(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("that file could not be read as an image"));
        };
        img.src = url;
    });
}

function chatDecodeImage(file) {
    if (typeof window.createImageBitmap === "function") {
        return window.createImageBitmap(file).catch(() => chatDecodeViaImg(file));
    }
    return chatDecodeViaImg(file);
}

function chatCanvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        if (typeof canvas.toBlob !== "function") {
            reject(new Error("this browser cannot re-encode images"));
            return;
        }
        canvas.toBlob((out) => {
            if (out) resolve(out);
            else reject(new Error("that image could not be re-encoded"));
        }, type, quality);
    });
}

/* A phone photo is 4000px wide and 5MB. Kept whole it is a few hundred times
   more detail than a chat bubble needs, so anything over the edge limit is
   scaled down and re-encoded in its own format - keeping the format rather than
   always writing JPEG, because re-encoding a PNG as JPEG throws away the
   transparency that made it a PNG. */
function chatPrepareImage(file) {
    return chatSniffImage(file).then((sniffed) => {
        if (!sniffed || !CHAT_IMAGE_TYPES[sniffed]) {
            throw new Error("that is not a PNG, JPEG, GIF or WebP image");
        }
        return chatDecodeImage(file).then((src) => {
            const w = src.width || src.naturalWidth || 0;
            const h = src.height || src.naturalHeight || 0;
            if (!w || !h) throw new Error("that image has no readable dimensions");

            /* A GIF is left exactly as it is: re-encoding one discards the
               animation, which is the only reason to send a GIF. If it is over
               the limit we say so rather than quietly turning it into a still. */
            if (sniffed === "image/gif") {
                if (file.size > CHAT_MAX_BYTES) {
                    throw new Error("that GIF is " + chatMb(file.size) + ", over the " + chatMb(CHAT_MAX_BYTES) + " limit");
                }
                if (typeof src.close === "function") src.close();
                return { blob: file, type: sniffed, width: w, height: h };
            }

            const scale = Math.min(1, CHAT_MAX_EDGE / Math.max(w, h));
            if (scale === 1 && file.size <= CHAT_MAX_BYTES) {
                if (typeof src.close === "function") src.close();
                return { blob: file, type: sniffed, width: w, height: h };
            }

            const outW = Math.max(1, Math.round(w * scale));
            const outH = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement("canvas");
            canvas.width = outW;
            canvas.height = outH;

            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("this browser cannot resize images");
            ctx.drawImage(src, 0, 0, outW, outH);
            if (typeof src.close === "function") src.close();

            return chatCanvasBlob(canvas, sniffed, 0.82).then((blob) => ({
                blob: blob,
                /* the browser may hand back a different type than asked for, so
                   the stored type is the one the bytes actually are */
                type: blob.type || sniffed,
                width: outW,
                height: outH,
            }));
        });
    });
}

function chatWhen(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return time;
    return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " at " + time;
}

function initGroupChat() {
    const log = document.getElementById("chat-log");
    if (!log) return;   /* not the chat page */

    const form = document.getElementById("chat-form");
    const text = document.getElementById("chat-text");
    const file = document.getElementById("chat-file");
    const attachLabel = document.getElementById("chat-attach");
    const preview = document.getElementById("chat-preview");
    const previewImg = document.getElementById("chat-preview-img");
    const previewNote = document.getElementById("chat-preview-note");
    const dropPreview = document.getElementById("chat-preview-drop");
    const send = document.getElementById("chat-send");
    const gate = document.getElementById("chat-gate");
    const gateText = document.getElementById("chat-gate-text");
    const gateJoin = document.getElementById("chat-gate-join");
    const title = document.getElementById("chat-title");
    const meta = document.getElementById("chat-meta");
    const note = document.getElementById("chat-note");

    let db = null;
    let groupId = "";
    let registry = [];
    let pending = null;   /* the prepared image waiting to be sent */
    let previewUrl = "";
    let liveUrls = [];    /* object URLs of images in the log, revoked on repaint */
    let busy = false;

    const say = (text) => { if (note) note.textContent = text; };

    /* An object URL pins its blob in memory for the life of the document, so every
       one is released when the log is rebuilt. Without this, scrolling back and
       forth through a long conversation would leak the whole history. */
    const releaseLogUrls = () => {
        liveUrls.forEach((url) => URL.revokeObjectURL(url));
        liveUrls = [];
    };

    const dropPending = () => {
        pending = null;
        if (file) file.value = "";
        if (preview) preview.hidden = true;
        if (previewImg) previewImg.removeAttribute("src");
        if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }
    };

    const rowLabel = () => {
        const row = registry.filter((g) => g.id === groupId)[0];
        return row ? row.label : groupId;
    };

    /* Posting is for members, so the composer is only offered once there is an
       account and a membership. The check runs again at send time: membership
       can be removed in another tab, and a page opened ten minutes ago is not
       evidence of anything. */
    const applyGate = () => {
        if (!groupId) return;

        const who = sessionOf();
        const member = who.email && myGroups().indexOf(groupId) > -1;

        if (gate) {
            gate.hidden = !!member;
            if (!member) {
                gateText.textContent = who.email
                    ? "You are not in " + rowLabel() + " yet. Join it to post in the chat."
                    : "Sign in and join " + rowLabel() + " to post in the chat.";
                gateJoin.hidden = !who.email;
            }
        }
        if (form) form.hidden = !member;
    };

    /* The group id arrives in the query string, so it is checked against the
       registry before anything is done with it - an unrecognised one has no
       label, no blurb and no members, and writing messages against it would
       create a room that nothing in the UI can explain. */
    const wanted = new URLSearchParams(window.location.search).get("g") || "";

    chatOpenDb().then((opened) => {
        db = opened;
        return fetch("/api/groups").then((res) => (res.ok ? res.json() : null));
    }).then((data) => {
        registry = (data && data.groups) || [];
        const row = registry.filter((g) => g.id === wanted)[0];

        if (!wanted || !row) {
            say("That group link is not one we recognise.");
            if (title) title.textContent = "Group not found";
            if (meta) meta.textContent = "";
            if (form) form.hidden = true;
            return;
        }

        groupId = row.id;
        document.title = row.label + " - Future Era chat";
        if (title) title.textContent = row.label;
        if (meta) meta.textContent = row.members + " members - " + row.blurb;

        applyGate();
        render();
    }).catch((err) => {
        if (title) title.textContent = "Chat unavailable";
        if (meta) meta.textContent = "";
        if (form) form.hidden = true;
        say(err && err.message ? err.message : "chat storage is not available in this browser");
    });

    const renderOne = (m) => {
        const mine = m.email === sessionOf().email;
        const who = m.name || m.email || "Someone";
        const body = [];

        if (m.text) body.push('<p class="chat__text">' + esc(m.text) + "</p>");

        if (m.imageId) {
            /* The dimensions are stored with the message so the space is reserved
               before the blob arrives, rather than the log jumping as images
               land. The file name and type are never interpolated here: they came
               off disk, and only the sniffed type is trusted. */
            const dims = m.imageW && m.imageH
                ? ' width="' + Number(m.imageW) + '" height="' + Number(m.imageH) + '"'
                : "";
            body.push('<div class="chat__pic"><img class="chat__image" alt="Image sent by ' +
                esc(who) + '" data-image="' + esc(m.imageId) + '"' + dims + "></div>");
        }

        return '<li class="chat__msg' + (mine ? " is-mine" : "") + '">' +
            '<p class="chat__meta"><b>' + esc(who) + "</b>" +
            (mine ? "" : " <span>" + esc(m.email || "") + "</span>") +
            '<time datetime="' + new Date(m.created).toISOString() + '">' +
            esc(chatWhen(m.created)) + "</time></p>" +
            body.join("") + "</li>";
    };

    const render = () => {
        if (!db || !groupId) return;

        chatListMessages(db, groupId).then((rows) => {
            releaseLogUrls();

            if (!rows.length) {
                log.innerHTML = '<li class="chat__none">No messages yet. Say something.</li>';
                return;
            }

            log.innerHTML = rows.map(renderOne).join("");

            /* Blobs are fetched one at a time and put in by id, so one missing or
               unreadable image cannot take the rest of the conversation with it. */
            rows.filter((m) => m.imageId).forEach((m) => {
                chatGetImage(db, m.imageId).then((rec) => {
                    const img = log.querySelector('[data-image="' + CSS.escape(m.imageId) + '"]');
                    if (!rec || !img) return;

                    const url = URL.createObjectURL(rec.blob);
                    liveUrls.push(url);
                    img.src = url;
                    img.addEventListener("load", function () {
                        /* once it is painted the reserved box is the wrong size */
                        img.removeAttribute("width");
                        img.removeAttribute("height");
                    });
                }).catch(() => {
                    const img = log.querySelector('[data-image="' + CSS.escape(m.imageId) + '"]');
                    if (img) {
                        const wrap = img.parentNode;
                        if (wrap) wrap.innerHTML = '<p class="chat__missing">image could not be loaded</p>';
                    }
                });
            });

            const near = log.scrollHeight - log.clientHeight - log.scrollTop < 120;
            if (near || !log.dataset.seen) {
                log.scrollTop = log.scrollHeight;
                log.dataset.seen = "1";
            }
        }).catch((err) => say(err.message || "the conversation could not be read"));
    };

    const take = (fileIn) => {
        if (!fileIn) return;
        say("");

        chatPrepareImage(fileIn).then((image) => {
            pending = image;

            if (preview) preview.hidden = false;
            if (previewNote) {
                previewNote.textContent = chatMb(image.blob.size) + " - " +
                    image.width + "x" + image.height + " - ready to send";
            }
            if (previewImg) {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                previewUrl = URL.createObjectURL(image.blob);
                previewImg.src = previewUrl;
            }
        }).catch((err) => {
            dropPending();
            say(err && err.message ? err.message : "that image cannot be attached");
        });
    };

    if (file) file.addEventListener("change", () => take(file.files && file.files[0]));
    if (attachLabel && file) {
        /* The label is a real <label for>, so the file dialog opens on click and
           on Enter with no script at all. This is belt and braces for the same
           reason as the accept attribute: a hint is not a filter. */
        attachLabel.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
        });
    }
    if (dropPreview) {
        dropPreview.addEventListener("click", () => { dropPending(); say(""); });
    }

    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            if (busy) return;

            const who = sessionOf();
            if (!who.email) {
                window.dispatchEvent(new CustomEvent("future-era:open-auth"));
                return;
            }
            if (myGroups().indexOf(groupId) === -1) {
                applyGate();
                say("you are not a member of this group any more");
                return;
            }

            const body = text ? text.value.trim() : "";
            if (!body && !pending) {
                say("write something, or attach an image");
                if (text) text.focus();
                return;
            }
            if (body.length > CHAT_MAX_TEXT) {
                say("that message is " + body.length + " characters; the limit is " + CHAT_MAX_TEXT);
                return;
            }

            const record = {
                group: groupId,
                email: who.email,
                name: String(who.name || who.email).trim(),
                text: body.slice(0, CHAT_MAX_TEXT),
                created: Date.now(),
            };
            if (pending) {
                record.imageId = "";
                record.imageType = pending.type;
                record.imageW = pending.width;
                record.imageH = pending.height;
            }

            busy = true;
            if (send) send.disabled = true;
            say("sending...");

            const image = pending;
            chatStoreMessage(db, record, image)
                .then(() => {
                    if (text) text.value = "";
                    dropPending();
                    say("");
                    render();
                })
                .catch((err) => {
                    /* A full disk and a rejected blob both land here, and both are
                       worth saying out loud: the alternative is a message that
                       looks sent and is not. */
                    say((err && err.message ? err.message : "the message was not saved") +
                        " - it has not been sent.");
                })
                .then(() => {
                    busy = false;
                    if (send) send.disabled = false;
                });
        });
    }

    if (gateJoin) {
        gateJoin.addEventListener("click", () => {
            if (myGroups().indexOf(groupId) === -1) setMyGroups(myGroups().concat([groupId]));
            applyGate();
        });
    }

    /* Signing in, signing out, or a join or leave made in another tab all change
       whether the composer should be there at all. */
    window.addEventListener("future-era:session", () => { applyGate(); render(); });
    window.addEventListener("future-era:groups-changed", () => { applyGate(); render(); });

    window.addEventListener("pagehide", () => {
        releaseLogUrls();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (db) db.close();
    });
}

function init() {
    /* The CSS starts the hero, the scroll cue and a few sections at opacity: 0
       so GSAP can fade them in. If we are not going to animate - no GSAP, or
       the visitor asked for reduced motion - cancel that starting state first,
       otherwise the page renders blank instead of static. */
    if (!MOTION.ok) document.documentElement.classList.add("no-motion");

    if (MOTION.ok && window.ScrollTrigger) {
        step("registerPlugin", () => gsap.registerPlugin(ScrollTrigger));
    }

    /* Each step is isolated: a throw in one must not take the rest of the
       page's animations down with it. */
    step("nav", initNav);
    step("auth", initAuth);
    step("intro", initIntro);
    step("about", initAbout);
    step("creators", initCreators);
    step("community", initCommunity);
    step("communityFollow", initCommunityFollow);
    step("communityGroups", initCommunityGroups);
    step("groupChat", initGroupChat);
    step("profile", initProfile);
    step("careerHero", initCareerHero);
    step("footer", initFooter);

    /* Only the career page needs the API, and it must not block the others -
       if the backend is down the home and creators pages still animate fine.
       initCareerHero already ran above, so the career hero animates either
       way. */
    if (document.getElementById("pathform")) {
        loadCareerData()
            .then(() => step("career", initCareer))
            .catch(showDataError);
    }
}

/* ---------- career data over HTTP ----------
   This used to be a <script src="career-data.js"> tag, which meant the data
   was a JS file the browser executed. It now lives in the FastAPI backend and
   arrives as JSON, so these are assigned at runtime instead of being consts. */
let RESOURCES, STREAMS, DURATIONS, DEGREES, INTERESTS, HOBBIES, SKILLS,
    ROLES, PHASES, GENERIC_ITEM, GENERIC_PHASES;

function loadCareerData() {
    return fetch("/api/career-data")
        .then((res) => {
            if (!res.ok) throw new Error("server said " + res.status);
            return res.json();
        })
        .then((data) => {
            RESOURCES = data.RESOURCES;
            STREAMS = data.STREAMS;
            DURATIONS = data.DURATIONS;
            DEGREES = data.DEGREES;
            INTERESTS = data.INTERESTS;
            HOBBIES = data.HOBBIES;
            SKILLS = data.SKILLS;
            ROLES = data.ROLES;
            PHASES = data.PHASES;
            GENERIC_ITEM = data.GENERIC_ITEM;
            GENERIC_PHASES = data.GENERIC_PHASES;
        });
}

/* The backend being unreachable should say so, not just leave a dead form. */
function showDataError(err) {
    const form = document.getElementById("pathform");
    if (!form) return;

    form.innerHTML =
        '<p class="cform__error" role="alert">' +
        "Could not load the career data (" + String(err.message || err) + "). " +
        "Start the backend with <code>python main.py</code> and reload." +
        "</p>";

    if (window.console) console.error("career data failed to load:", err);
}

if (document.readyState === "complete") {
    init();
} else {
    window.addEventListener("load", init);
}
