/* ============ EXTRACT ============ */

// Read a File object as text >:>
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read " + file.name));
    reader.readAsText(file);
  });
}

// CSV parser that handles quoted fields, commas/newlines inside quotes, and BOM >:>
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  // drop completely empty lines >:>
  const clean = rows.filter(r => r.some(v => v.trim() !== ""));
  if (!clean.length) return [];

  const headers = clean[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return clean.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i] !== undefined ? r[i] : "");
    return obj;
  });
}

/* ============ TRANSFORMERS ============ */

const PROGRAM_MAP = {
  BSIT: "Bachelor of Science in Information Technology",
  BSCS: "Bachelor of Science in Computer Science",
  BSIS: "Bachelor of Science in Information Systems"
};

const trim = v => (v === undefined || v === null) ? "" : String(v).trim();

// Collapse internal whitespace, then Proper Case ("JUAN dela CRUZ" -> "Juan Dela Cruz") >:>
function properCase(v) {
  return trim(v).replace(/\s+/g, " ").toLowerCase()
    .replace(/(^|[\s\-'’.])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// "completed" / "COMPLETED" -> "Completed"; "in progress" -> "In Progress" >:>
function normalizeStatus(v) {
  const t = trim(v).replace(/\s+/g, " ");
  return t ? properCase(t) : null;
}

function toStudentId(v) {
  const digits = trim(v).replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

// Numeric grades -> Number; non-numeric (INC, DRP, etc.) kept as an uppercase status string >:>
function transformGrade(v) {
  const t = trim(v);
  if (t === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.toUpperCase();
}

// "₱1,250.50", " 1250.5 ", "(300)" -> number >:>
function toDecimal(v) {
  let t = trim(v);
  if (t === "") return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  t = t.replace(/[^0-9.]/g, "");
  if (t === "" || isNaN(Number(t))) return null;
  const n = Number(t);
  return negative ? -n : n;
}

function transform(sis, lms, acc) {
  // Index LMS and Accounting rows by student id >:>
  const lmsById = new Map();
  lms.forEach(r => {
    const id = toStudentId(r.student_id);
    if (id === null) return;
    if (!lmsById.has(id)) lmsById.set(id, []);
    lmsById.get(id).push({
      courseCode: trim(r.course_code).toUpperCase(),
      finalGrade: transformGrade(r.final_grade),
      completionStatus: normalizeStatus(r.completion_status)
    });
  });

  const accById = new Map();
  acc.forEach(r => {
    const id = toStudentId(r.student_id);
    if (id === null || accById.has(id)) return;
    accById.set(id, {
      outstandingBalance: toDecimal(r.account_balance),
      currency: trim(r.currency).toUpperCase() || null
    });
  });

  // SIS is the master list: every SIS student is kept even without LMS/Accounting data >:>
  return sis
    .filter(r => toStudentId(r.student_id) !== null)
    .map(r => {
      const id = toStudentId(r.student_id);
      const code = trim(r.program_code).toUpperCase();
      const accounting = accById.get(id);
      return {
        studentId: id,
        studentName: properCase(r.student_name),
        program: PROGRAM_MAP[code] || code || null,
        emailAddress: trim(r.email).toLowerCase() || null,
        courses: lmsById.get(id) || [],
        outstandingBalance: accounting ? accounting.outstandingBalance : null,
        currency: accounting ? accounting.currency : null
      };
    });
}

/* ============ LOADDD (JSON output) ============ */

document.getElementById("runBtn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const output = document.getElementById("output");

  const sisFile = document.getElementById("sisFile").files[0];
  const lmsFile = document.getElementById("lmsFile").files[0];
  const accFile = document.getElementById("accFile").files[0];

  if (!sisFile || !lmsFile || !accFile) {
    status.textContent = "Please choose all three CSV files before running the ETL.";
    return;
  }

  try {
    const [sisText, lmsText, accText] = await Promise.all([
      readFile(sisFile), readFile(lmsFile), readFile(accFile)
    ]);

    const sis = parseCSV(sisText);
    const lms = parseCSV(lmsText);
    const acc = parseCSV(accText);

    const students = transform(sis, lms, acc);

    output.textContent = JSON.stringify({ students: students }, null, 2);
    status.textContent = "ETL complete: " + students.length + " student record(s) from " +
      sis.length + " SIS, " + lms.length + " LMS, and " + acc.length + " Accounting row(s).";
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});
