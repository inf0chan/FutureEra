/* =========================================================
   Future Era â€” intro animation timeline
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
   Career blueprint â€” one scrolling form, two paths
   ========================================================= */

const CAREER_PATHS = [
    {
        id: 'student', label: '12th Pass Student',
        blurb: 'School just ended. No degree, no plan â€” and no reason that has to be a problem.'
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
                : (state.path ? 'Ready. This runs entirely in your browser â€” nothing is sent anywhere.' : '');
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
    step("intro", initIntro);
    step("about", initAbout);
    step("creators", initCreators);
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
        "Start the backend with <code>uvicorn main:app</code> and reload." +
        "</p>";

    if (window.console) console.error("career data failed to load:", err);
}

if (document.readyState === "complete") {
    init();
} else {
    window.addEventListener("load", init);
}
