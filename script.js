/* script.js – US 24355 app: FINAL + DEADLINE + HINTS ONLY UNDER QUESTIONS */
// ------------------------------------------------------------
// Local storage – now dynamic & versioned
// ------------------------------------------------------------
let STORAGE_KEY;               // will be set after questions load
let data = { answers: {} };    // default
let currentAssessmentId = null; // track which assessment is loaded

function initStorage(appId, version = 'noversion') {
  STORAGE_KEY = `${appId}_${version}_DATA`;

  // ---- migrate old TECH_DATA (run once) ----
  const OLD_KEY = "TECH_DATA";
  if (localStorage.getItem(OLD_KEY) && !localStorage.getItem(STORAGE_KEY)) {
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old?.answers) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
      }
      localStorage.removeItem(OLD_KEY);
    } catch (e) {
      console.warn("Migration from TECH_DATA failed:", e);
    }
  }

  // load existing data if present
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") data = parsed;
    }
  } catch (e) {
    console.warn("Failed to parse stored data:", e);
  }
}

// ------------------------------------------------------------
// XOR obfuscation helpers
// ------------------------------------------------------------
const XOR_KEY = 47;

const xorEncode = s => {
  if (!s) return "";
  return btoa(
    s
      .split("")
      .map(c => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY))
      .join("")
  );
};

const xorDecode = s => {
  if (!s) return "";
  try {
    return atob(s)
      .split("")
      .map(c => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY))
      .join("");
  } catch (_) {
    return "";
  }
};

// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
let APP_TITLE, APP_SUBTITLE, TEACHERS, ASSESSMENTS;
let DEADLINE = null; // from questions.json.DEADLINE

// ------------------------------------------------------------
// DEBUG MODE
// ------------------------------------------------------------
const DEBUG = false; // ← Debug logging off in production

// ------------------------------------------------------------
// Requirements
// ------------------------------------------------------------
const MIN_PCT_FOR_SUBMIT = 100;
// Change this to e.g. 80 if you want 80% or better

// ------------------------------------------------------------
// Load questions.json (now also extracts APP_ID & VERSION & DEADLINE)
// ------------------------------------------------------------
async function loadQuestions() {
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.textContent = "Loading questions…";
  try {
    const res = await fetch("questions.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (DEBUG) console.log("JSON loaded:", json);

    // ---- read APP_ID & VERSION ----
    const appId = json.APP_ID;
    const version = json.VERSION || "noversion";
    if (!appId) throw new Error("questions.json missing APP_ID");
    initStorage(appId, version);   // ← creates STORAGE_KEY & loads data

    APP_TITLE = json.APP_TITLE;
    APP_SUBTITLE = json.APP_SUBTITLE;
    TEACHERS = json.TEACHERS;
    DEADLINE = json.DEADLINE || null;

    ASSESSMENTS = (json.ASSESSMENTS || []).map(ass => ({
      ...ass,
      questions: ass.questions.map(q => ({
        ...q,
        rubric: (q.rubric || []).map(r => ({
          ...r,
          check: new RegExp(r.check, r.flags || "i")
        }))
      }))
    }));
    if (DEBUG) console.log("ASSESSMENTS ready:", ASSESSMENTS);
  } catch (err) {
    console.error("Failed to load questions.json:", err);
    const msg = `
      <div style="text-align:center;padding:40px;color:#e74c3c;font-family:sans-serif;">
        <h2>Failed to load assessment</h2>
        <p><strong>Error:</strong> ${err.message}</p>
        <p>Check: <code>questions.json</code> exists, valid JSON, and you're using a web server.</p>
      </div>`;
    document.body.innerHTML = msg;
    throw err;
  } finally {
    if (loadingEl) loadingEl.remove();
  }
}

// ------------------------------------------------------------
// initApp
// ------------------------------------------------------------
function initApp() {
  document.getElementById("page-title").textContent = APP_TITLE;
  document.getElementById("app-title").textContent = APP_TITLE;
  document.getElementById("app-subtitle").textContent = APP_SUBTITLE;

  // Teacher dropdown
  const teacherSel = document.getElementById("teacher");
  TEACHERS.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    teacherSel.appendChild(opt);
  });

  // Assessment dropdown
  const assSel = document.getElementById("assessmentSelector");
  ASSESSMENTS.forEach((ass, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = ass.title;
    assSel.appendChild(opt);
  });

  // Restore stored basic info
  if (data.name) document.getElementById("name").value = data.name;
  if (data.id) {
    const idEl = document.getElementById("id");
    idEl.value = data.id;
    // ✅ Only lock if we've actually locked it before (after first assessment load)
    if (data.idLocked) {
      idEl.readOnly = true;
      idEl.classList.add("locked-field");
      document.getElementById("locked-msg").classList.remove("hidden");
      document.getElementById("locked-id").textContent = data.id;
    }
  }
  if (data.teacher) teacherSel.value = data.teacher;

  // Deadline banner / locking
  setupDeadlineBanner();
}

// ------------------------------------------------------------
// Save / load answers  (now per-assessment)
// ------------------------------------------------------------
function saveAnswer(qid) {
  if (!currentAssessmentId) return;
  const field = document.getElementById("q" + qid);
  if (!field) return;
  const val = field.value;
  if (!data.answers[currentAssessmentId]) {
    data.answers[currentAssessmentId] = {};
  }
  data.answers[currentAssessmentId][qid] = xorEncode(val);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getAnswer(qid) {
  if (!currentAssessmentId) return "";
  const enc = data.answers[currentAssessmentId]?.[qid];
  return xorDecode(enc || "");
}

// ------------------------------------------------------------
// Toast
// ------------------------------------------------------------
let toastTimeout;
function showToast(msg, ok = true) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove("error", "show");
  if (!ok) toast.classList.add("error");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
}

const PASTE_BLOCKED_MESSAGE = "Pasting blocked – please type your own answer.";

// ------------------------------------------------------------
// Student info
// ------------------------------------------------------------
function saveStudentInfo() {
  data.name = document.getElementById("name").value.trim();
  data.id = document.getElementById("id").value.trim();
  data.teacher = document.getElementById("teacher").value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadAssessment() {
  const idx = document.getElementById("assessmentSelector").value;
  if (idx === "") return;

  const idEl = document.getElementById("id");
  if (!idEl.value.trim()) {
    showToast("Please enter your Student ID first.", false);
    return;
  }

  saveStudentInfo();

  // ✅ Lock ID to device after the FIRST assessment load
  if (data.id && !data.idLocked) {
    data.idLocked = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    idEl.readOnly = true;
    idEl.classList.add("locked-field");
    document.getElementById("locked-msg").classList.remove("hidden");
    document.getElementById("locked-id").textContent = data.id;
    showToast("Student ID locked for this device.");
  }

  const ass = ASSESSMENTS[idx];
  currentAssessmentId = ass.id; // ✅ track which assessment we’re on

  const questionsDiv = document.getElementById("questions");
  questionsDiv.innerHTML = "";

  ass.questions.forEach(q => {
    const wrap = document.createElement("div");
    wrap.className = "question";
    wrap.id = "q-" + q.id.toLowerCase();

    const header = document.createElement("div");
    header.className = "question-header";

    const markSpan = document.createElement("span");

    // Clean display ID: "q5" -> "Q5", others -> uppercased
    let displayId;
    const simpleMatch = q.id.match(/^q(\d+)$/i);
    if (simpleMatch) {
      // IDs like "q1", "q2", "q15" become "Q1", "Q2", "Q15"
      displayId = "Q" + simpleMatch[1];
    } else {
      // Anything else (e.g. "mat1_q1") just uppercase
      displayId = q.id.toUpperCase();
    }

    markSpan.textContent = `${displayId} – ${q.maxPoints} mark${q.maxPoints !== 1 ? "s" : ""}`;
    header.appendChild(markSpan);

    const typeSpan = document.createElement("span");
    typeSpan.textContent = q.type === "mc" ? "Multi-choice" :
                            q.type === "short" ? "Short answer" :
                            "Extended answer";
    header.appendChild(typeSpan);

    wrap.appendChild(header);

    const p = document.createElement("p");
    // If your question text includes HTML (like links/br), use innerHTML instead of textContent
    p.innerHTML = q.text;
    wrap.appendChild(p);

    if (q.image) {
      const img = document.createElement("img");
      img.src = q.image;
      img.alt = "Question image";
      wrap.appendChild(img);
    }

    let field;
    const fieldId = "q" + q.id;
    if (q.type === "mc") {
      field = document.createElement("select");
      field.id = fieldId;
      field.className = "answer-field";
      const blankOpt = document.createElement("option");
      blankOpt.value = "";
      blankOpt.textContent = "Select an answer";
      field.appendChild(blankOpt);
      (q.options || []).forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        field.appendChild(o);
      });
    } else if (q.type === "short") {
      field = document.createElement("input");
      field.type = "text";
      field.id = fieldId;
      field.className = "answer-field";
      field.placeholder = "Type your answer";
    } else {
      field = document.createElement("textarea");
      field.id = fieldId;
      field.className = "answer-field";
      field.rows = 4;
      field.placeholder = "Write your answer here";
    }

    const prev = getAnswer(q.id);
    if (prev) field.value = prev;

    wrap.appendChild(field);

    questionsDiv.appendChild(wrap);
  });

  attachProtection();
  showToast("Assessment loaded.");
}

function gradeIt() {
  const idx = document.getElementById("assessmentSelector").value;
  if (idx === "") return { total: 0, results: [], totalPoints: 0 };

  const ass = ASSESSMENTS[idx];
  let total = 0;
  let totalPoints = 0;

  const results = ass.questions.map(q => {
    const field = document.getElementById("q" + q.id);
    const ans = (field?.value || "").trim();
    saveAnswer(q.id);

    let earned = 0;
    // default to the question-level hint so wrong answers still get help
    let bestHint = q.hint || "";

    (q.rubric || []).forEach(rule => {
      if (rule.check.test(ans)) {
        if (q.maxPoints === 1) {
          // Single-mark question: any matching rule gives full credit (up to 1)
          earned = Math.max(earned, Math.min(rule.points, q.maxPoints));
        } else {
          // Multi-mark question: each matched rule contributes its points
          earned += rule.points;
        }
        if (rule.hint) bestHint = rule.hint; // rubric-specific hint overrides
      }
    });

    // Cap to the question's maximum
    if (earned > q.maxPoints) earned = q.maxPoints;

    total += earned;
    totalPoints += q.maxPoints;

    return {
      id: q.id.toUpperCase(),
      earned,
      max: q.maxPoints,
      answer: ans,
      text: q.text,
      hint: bestHint
    };
  });

  return { total, results, totalPoints };
}

// ------------------------------------------------------------
// Colour question cards + show hints UNDER questions only
// ------------------------------------------------------------
function colourQuestions(results) {
  results.forEach(r => {
    // r.id is from gradeIt(): q.id.toUpperCase(), e.g. "Q1" or "MAT1_Q1"
    const qid = r.id.toLowerCase(); // back to "q1", "mat1_q1"
    const box = document.getElementById("q-" + qid);
    if (!box) return;

    // Clear previous state
    box.classList.remove("correct", "partial", "wrong");

    // Decide status from marks
    const status =
      r.earned === r.max ? "correct" :
      r.earned > 0       ? "partial" :
                           "wrong";

    box.classList.add(status);

    // ----- HINT UNDER QUESTION (ON FORM ONLY) -----
    const hintClass = "hint-inline";
    let hintEl = box.querySelector("." + hintClass);

    if (r.earned < r.max && r.hint) {
      // Needs a hint: create/update the inline hint element
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.className = hintClass;
        box.appendChild(hintEl);
      }
      hintEl.innerHTML = `<strong>Hint:</strong> ${r.hint}`;
      hintEl.style.display = "block";   // ⇐ make it visible
    } else if (hintEl) {
      // Fully correct (or no hint): hide but keep the element
      hintEl.style.display = "none";    // ⇐ hide it again
    }
  });
}

// ------------------------------------------------------------
// Deadline helpers
// ------------------------------------------------------------
function getDeadlineStatus(now = new Date()) {
  if (!DEADLINE) return null;

  const year = now.getFullYear();
  const d = parseInt(DEADLINE.day, 10);
  const m = parseInt(DEADLINE.month, 10) - 1;
  const label = DEADLINE.label || "Assessment deadline";

  const deadlineDate = new Date(year, m, d);
  const todayMid = new Date(year, now.getMonth(), now.getDate());

  const diffMs = deadlineDate - todayMid;
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) {
    return {
      status: "upcoming",
      daysLeft: diffDays,
      label,
      dateStr: deadlineDate.toLocaleDateString()
    };
  } else if (diffDays === 0) {
    return {
      status: "today",
      daysLeft: 0,
      label,
      dateStr: deadlineDate.toLocaleDateString()
    };
  } else {
    return {
      status: "overdue",
      overdueDays: Math.abs(diffDays),
      label,
      dateStr: deadlineDate.toLocaleDateString()
    };
  }
}

// Lock fields once deadline passed
function lockAllFieldsForDeadline() {
  const questionsDiv = document.getElementById("questions");
  if (questionsDiv) {
    questionsDiv.querySelectorAll("input, textarea, select").forEach(el => {
      el.readOnly = true;
      if (el.tagName === "SELECT") el.disabled = true;
      el.classList.add("locked-field");
    });
  }

  const nameEl = document.getElementById("name");
  const idEl = document.getElementById("id");
  const teacherEl = document.getElementById("teacher");
  const assSel = document.getElementById("assessmentSelector");
  const emailBtn = document.getElementById("emailBtn");

  [nameEl, idEl].forEach(el => {
    if (el) {
      el.readOnly = true;
      el.classList.add("locked-field");
    }
  });

  [teacherEl, assSel].forEach(el => {
    if (el) el.disabled = true;
  });

  if (emailBtn) emailBtn.disabled = true;
}

function setupDeadlineBanner() {
  const banner = document.getElementById("deadline-banner");
  if (!banner) return;

  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || data;
    } catch {
      return data;
    }
  })();

  if (!stored.deadlineInfo) {
    stored.deadlineInfo = {};
  }

  if (!stored.deadlineInfo.firstSeen) {
    stored.deadlineInfo.firstSeen = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  const now = new Date();
  const deadlineStatus = getDeadlineStatus(now);
  if (!deadlineStatus) {
    banner.classList.add("hidden");
    return;
  }

  const firstSeen = new Date(stored.deadlineInfo.firstSeen);
  const daysSinceStart = Math.floor((now - firstSeen) / 86400000);

  let cls = "info";
  let text = "";
  const { status: st, label, dateStr, daysLeft, overdueDays } = {
    status: deadlineStatus.status,
    label: deadlineStatus.label,
    dateStr: deadlineStatus.dateStr,
    daysLeft: deadlineStatus.daysLeft ?? null,
    overdueDays: deadlineStatus.overdueDays ?? null
  };

  if (st === "upcoming") {
    if (daysLeft <= 7) cls = "hot";
    else if (daysLeft <= 28) cls = "warn";
    else cls = "info";

    text = `${label}: ${dateStr} – ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;
    if (daysSinceStart !== null && daysSinceStart >= 0) {
      text += ` You started ${daysSinceStart} day${daysSinceStart === 1 ? "" : "s"} ago.`;
    }

    if (daysLeft > 0 && daysLeft <= 7) {
      showToast(`Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left to complete this assessment.`, false);
    }
  } else if (st === "today") {
    cls = "hot";
    text = `${label}: ${dateStr} – Deadline is today!`;
    showToast("Deadline is today – make sure you submit your work.", false);
  } else if (st === "overdue") {
    cls = "over";
    text = `${label}: ${dateStr} – Deadline has passed. You are ${overdueDays} day${overdueDays === 1 ? "" : "s"} late.`;

    // 🔒 Lock everything once the deadline has passed
    lockAllFieldsForDeadline();
  }

  banner.className = `deadline-banner ${cls}`;
  banner.textContent = text;
  banner.classList.remove("hidden");
}

// Extra check on load: if deadline already passed, lock immediately
function applyDeadlineLockIfNeeded() {
  const status = getDeadlineStatus(new Date());
  if (status && status.status === "overdue") {
    lockAllFieldsForDeadline();
  }
}

// ------------------------------------------------------------
// Submit / result rendering
// ------------------------------------------------------------
let finalData = null;

function submitWork() {
  const teacherSel = document.getElementById("teacher");
  const assSel = document.getElementById("assessmentSelector");

  if (!document.getElementById("name").value.trim()) {
    showToast("Please enter your name.", false);
    return;
  }
  if (!document.getElementById("id").value.trim()) {
    showToast("Please enter your Student ID.", false);
    return;
  }
  if (!teacherSel.value) {
    showToast("Please select your teacher.", false);
    return;
  }
  if (!assSel.value) {
    showToast("Please select an assessment.", false);
    return;
  }

  const { total, results, totalPoints } = gradeIt();
  const pct = totalPoints > 0 ? Math.round((total / totalPoints) * 100) : 0;

  colourQuestions(results);

  const studentName = document.getElementById("name").value.trim();
  const teacherName = TEACHERS.find(t => t.id === teacherSel.value)?.name || "";

  document.getElementById("student").textContent = studentName;
  document.getElementById("teacher-name").textContent = teacherName;
  document.getElementById("grade").innerHTML = `${total}/${totalPoints} <small>(${pct}%)</small>`;

  const answersDiv = document.getElementById("answers");
  answersDiv.innerHTML = "";

  results.forEach(r => {
    const fb = document.createElement("div");
    const status =
      r.earned === r.max ? "correct" :
      r.earned > 0       ? "partial" :
                           "wrong";
    fb.className = `feedback ${status}`;
    fb.innerHTML = `
  <h3>${r.id}: ${r.text}</h3>
  <p><strong>Your answer:</strong> ${r.answer || "<em>No answer provided</em>"}</p>
  <p><strong>Result:</strong> ${
    status === "correct" ? "Correct" :
    status === "partial" ? "Partially correct" :
                           "Incorrect"
  } (${r.earned}/${r.max} marks)</p>
`;

    answersDiv.appendChild(fb);
  });

  const deadlineNow = getDeadlineStatus(new Date());

  // ✅ Freeze submission time ONCE (so PDF always shows "Submitted:" correctly)
  const submittedAtIso = new Date().toISOString();

  finalData = {
    studentName,
    studentId: document.getElementById("id").value.trim(),
    teacherName,
    assessmentTitle: ASSESSMENTS[assSel.value].title,
    assessmentSubtitle: ASSESSMENTS[assSel.value].subtitle || "",
    points: total,
    totalPoints,
    pct,
    timestamp: submittedAtIso,
    deadlineInfo: deadlineNow
  };

  const emailBtn = document.getElementById("emailBtn");
  if (pct >= MIN_PCT_FOR_SUBMIT && (!deadlineNow || deadlineNow.status !== "overdue")) {
    emailBtn.disabled = false;
    showToast("Great job! You can now email your work.", true);
  } else {
    emailBtn.disabled = true;
    if (pct < MIN_PCT_FOR_SUBMIT) {
      showToast(`You have ${pct}%. You need at least ${MIN_PCT_FOR_SUBMIT}% to email your work.`, false);
    } else if (deadlineNow && deadlineNow.status === "overdue") {
      showToast("The deadline has passed – emailing is disabled.", false);
    }
  }

  document.getElementById("form").classList.add("hidden");
  document.getElementById("result").classList.remove("hidden");
}

function back() {
  document.getElementById("result").classList.add("hidden");
  document.getElementById("form").classList.remove("hidden");
}

// ------------------------------------------------------------
// Email / PDF – per-block capture (no mid-question cuts) +
// repeating header on every page (no overlap with maroon bar)
// with consistent width + more than one question per page
// and device-native sharing when available
//
// ✅ Includes:
// - PDF header shows Submitted date/time (from submitWork timestamp)
// - Filename includes StudentNo + StudentName + AssessmentTitle
// ------------------------------------------------------------
async function emailWork() {
  if (!finalData) return alert("Submit first!");

  // Enforce minimum percentage before emailing
  if (finalData.pct < MIN_PCT_FOR_SUBMIT) {
    return alert(`You must reach at least ${MIN_PCT_FOR_SUBMIT}% before emailing your work.`);
  }

  // Enforce deadline: no emailing after the deadline for this year
  const deadlineNow = getDeadlineStatus(new Date());
  if (deadlineNow && deadlineNow.status === "overdue") {
    return alert("The submission deadline has passed – emailing is now disabled until next year.");
  }

  // Formatting helpers
  const formatDateTime = iso => {
    try {
      return iso ? new Date(iso).toLocaleString() : "";
    } catch {
      return "";
    }
  };

  const safePart = s =>
    (s || "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_\-]/g, "");

  // Dynamically load jsPDF + html2canvas if needed
  const load = src => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });

  if (!(window.jspdf && window.html2canvas)) {
    await load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    await load("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  }

  if (!window.jspdf || !window.html2canvas) {
    alert("PDF libraries failed to load. Please check your internet connection.");
    return;
  }

  const { jsPDF } = window.jspdf;

  // ---------- CREATE PDF + GLOBAL PAGE DIMENSIONS ----------
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // ---------- PREP SCHOOL CREST ONCE ----------
  const crestImg = document.querySelector("header img.crest");
  let crestDataUrl = null;

  if (crestImg && crestImg.src) {
    try {
      const crestCanvas = document.createElement("canvas");
      crestCanvas.width = 60;
      crestCanvas.height = 60;
      const ctx = crestCanvas.getContext("2d");
      const tmpImg = new Image();
      tmpImg.crossOrigin = "anonymous";
      tmpImg.src = crestImg.src;
      await new Promise((res, rej) => {
        tmpImg.onload = res;
        tmpImg.onerror = rej;
      });
      ctx.drawImage(tmpImg, 0, 0, 60, 60);
      crestDataUrl = crestCanvas.toDataURL("image/png");
    } catch (e) {
      if (DEBUG) console.log("Crest image failed, continuing without:", e);
    }
  }

  // ---------- HEADER DRAW FUNCTION (EVERY PAGE) ----------
  const drawHeader = (isFirstPage = false) => {
    // Maroon bar
    pdf.setFillColor(110, 24, 24);
    pdf.rect(0, 0, pageWidth, 30, "F");

    // Crest on left, if available
    if (crestDataUrl) {
      pdf.addImage(crestDataUrl, "PNG", 10, 5, 20, 20);
    }

    // App title + subtitle in white
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.text(APP_TITLE || "Pukekohe High School", 35, 15);
    pdf.setFontSize(12);
    pdf.text(APP_SUBTITLE || "Technology Assessment", 35, 22);

    // Meta text (in black) under header – never overlaps maroon bar
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);

    const studentLineY = 40;

    if (isFirstPage) {
      // Full details first page
      pdf.text(`Student: ${finalData.studentName}`, 10, studentLineY);
      pdf.text(`ID: ${finalData.studentId}`, 10, studentLineY + 7);
      pdf.text(`Teacher: ${finalData.teacherName}`, 110, studentLineY);
      pdf.text(`Assessment: ${finalData.assessmentTitle}`, 10, studentLineY + 15);
      if (finalData.assessmentSubtitle) {
        pdf.text(`Part: ${finalData.assessmentSubtitle}`, 10, studentLineY + 22);
      }
      pdf.text(
        `Score: ${finalData.points}/${finalData.totalPoints} (${finalData.pct}%)`,
        10,
        studentLineY + 29
      );

      // Deadline info (optional)
      let infoY = studentLineY + 36;

      if (finalData.deadlineInfo) {
        const info = finalData.deadlineInfo;
        pdf.setFontSize(11);

        if (info.status === "overdue" && info.overdueDays > 0) {
          pdf.setTextColor(231, 76, 60);
          pdf.text(
            `Late submission: ${info.overdueDays} day${info.overdueDays === 1 ? "" : "s"} after deadline (${info.dateStr}).`,
            10,
            infoY
          );
        } else if (info.status === "today") {
          pdf.setTextColor(243, 156, 18);
          pdf.text(`Submitted on the deadline date (${info.dateStr}).`, 10, infoY);
        } else if (info.status === "upcoming") {
          pdf.setTextColor(39, 174, 96);
          pdf.text(
            `Submitted early: ${info.daysLeft} day${info.daysLeft === 1 ? "" : "s"} before deadline (${info.dateStr}).`,
            10,
            infoY
          );
        }

        infoY += 7;
      }

      // ✅ ALWAYS show submission timestamp + PDF generated timestamp
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(10);
      const submittedStr = formatDateTime(finalData.timestamp);
      pdf.text(`Submitted: ${submittedStr || "Unknown"}`, 10, infoY);
      infoY += 6;
      pdf.text(`PDF Generated: ${new Date().toLocaleString()}`, 10, infoY);
    } else {
      // Compact but still clear header on later pages
      pdf.text(`Student: ${finalData.studentName} (${finalData.studentId})`, 10, studentLineY);
      pdf.text(`Assessment: ${finalData.assessmentTitle}`, 10, studentLineY + 7);
      if (finalData.assessmentSubtitle) {
        pdf.setFontSize(11);
        pdf.text(`Part: ${finalData.assessmentSubtitle}`, 10, studentLineY + 14);
        pdf.setFontSize(12);
      }
    }
  };

  // ---------- LAYOUT CONSTANTS ----------
  const marginLeft = 10;
  const marginRight = 10;
  const marginTop = 70;     // space for header + meta
  const marginBottom = 10;  // footer
  const usableHeight = pageHeight - marginTop - marginBottom;

  // Use a fixed "virtual" width so PDFs look consistent across devices
  const TARGET_WIDTH = 900; // px – pretend the content is this wide for html2canvas

  // ---------- BUILD LIST OF BLOCKS TO CAPTURE ----------
  const resultSection = document.getElementById("result");
  const blocks = [];

  const resultHeader = resultSection.querySelector(".result-header");
  if (resultHeader) blocks.push(resultHeader);

  resultSection.querySelectorAll(".feedback").forEach(el => blocks.push(el));

  // Safety: if somehow no blocks found, fall back to whole section
  if (blocks.length === 0) {
    blocks.push(resultSection);
  }

  // ---------- DRAW FIRST PAGE HEADER ----------
  drawHeader(true);
  let currentY = marginTop;

  // ---------- CAPTURE EACH BLOCK SEPARATELY (NO MID-QUESTION CUTS) ----------
  for (const block of blocks) {
    const canvas = await window.html2canvas(block, {
      scale: 2,
      width: TARGET_WIDTH,
      windowWidth: TARGET_WIDTH,
      useCORS: true,
      scrollX: 0,
      scrollY: -window.scrollY
    });

    const imgData = canvas.toDataURL("image/png");
    const imgProps = pdf.getImageProperties(imgData);

    // Start from a max width based on margins
    const maxContentWidth = pageWidth - marginLeft - marginRight;
    let imgWidth = maxContentWidth;
    let imgHeight = (imgProps.height * imgWidth) / imgProps.width;

    // If this block is taller than ~90% of the usable space, scale it down a bit
    const maxBlockHeight = usableHeight * 0.9;
    if (imgHeight > maxBlockHeight) {
      const scale = maxBlockHeight / imgHeight;
      imgWidth *= scale;
      imgHeight = maxBlockHeight;
    }

    // Center horizontally on the page
    const xPos = (pageWidth - imgWidth) / 2;

    // If it won't fit on the current page, go to a new page
    if (currentY + imgHeight > pageHeight - marginBottom) {
      pdf.addPage();
      drawHeader(false);
      currentY = marginTop;
    }

    pdf.addImage(imgData, "PNG", xPos, currentY, imgWidth, imgHeight);
    currentY += imgHeight + 5; // 5mm gap between blocks
  }

  // ---------- PAGE NUMBERS IN FOOTER ----------
  const pageCount = pdf.getNumberOfPages();
  pdf.setFontSize(9);
  pdf.setTextColor(120, 130, 140);

  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.text(
      `Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: "center" }
    );
  }

  // ---------- EXPORT & SHARE / DOWNLOAD ----------
  const pdfBlob = pdf.output("blob");

  // ✅ File = StudentNo + StudentName + AssessmentTitle
  const fileName =
    `${safePart(finalData.studentId || "student")}_` +
    `${safePart(finalData.studentName || "name")}_` +
    `${safePart(finalData.assessmentTitle || "assessment")}.pdf`;

  let pdfFile = null;
  if (window.File && typeof File === "function") {
    pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });
  }

  // 1) Try device-native share sheet (phones/tablets, some desktops)
  if (pdfFile && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
    try {
      await navigator.share({
        title: "Assessment PDF",
        text: "Here is my completed assessment.",
        files: [pdfFile]
      });
      showToast("Shared via device share sheet.");
      return; // we’re done
    } catch (e) {
      console.warn("Share cancelled or failed, falling back to download:", e);
    }
  }

  // 2) Fallback: download the file
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Simple clipboard clear (best-effort)
// ------------------------------------------------------------
function clearClipboard() {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText("").catch(() => {});
  }
}

// ------------------------------------------------------------
// Attach protection to inputs (softened anti-cheat)
// ------------------------------------------------------------
function attachProtection() {
  document.querySelectorAll(".answer-field").forEach(f => {
    f.addEventListener("input", () => saveAnswer(f.id.slice(1)));
    // Block paste to discourage copy-paste answers, but allow copy/cut for accessibility
    f.addEventListener("paste", e => { e.preventDefault(); showToast(PASTE_BLOCKED_MESSAGE, false); clearClipboard(); });
  });
}

// Limit context menu blocking to the question area only (still allow on inputs)
document.addEventListener("contextmenu", e => {
  const inQuestionsArea = e.target.closest("#questions");
  if (inQuestionsArea && !e.target.matches("input, textarea")) {
    e.preventDefault();
  }
});

// ------------------------------------------------------------
// Service worker registration for offline/PWA
// ------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      if (DEBUG) console.log('Service worker registration failed:', err);
    });
  });
}

// ------------------------------------------------------------
// Export
// ------------------------------------------------------------
window.loadAssessment = loadAssessment;
window.submitWork = submitWork;
window.back = back;
window.emailWork = emailWork;

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestions();
  initApp();
  applyDeadlineLockIfNeeded();
});
