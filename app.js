const STORAGE_KEY = "job-tracker-applications";
const HISTORY_KEY = "job-tracker-history";
const EMAIL_QUEUE_KEY = "job-tracker-email-queue";
const SYNC_QUEUE_KEY = "job-tracker-sync-queue";
const BACKEND_URL_KEY = "job-tracker-backend-url";
const GHOST_DAYS = 14;

const form = document.getElementById("applicationForm");
const tableBody = document.getElementById("applicationTable");
const searchInput = document.getElementById("searchInput");
const stageFilter = document.getElementById("stageFilter");
const openCount = document.getElementById("openCount");
const ghostedCount = document.getElementById("ghostedCount");
const interviewCount = document.getElementById("interviewCount");
const offerCount = document.getElementById("offerCount");
const lastSyncLabel = document.getElementById("lastSyncLabel");
const ghostingResult = document.getElementById("ghostingResult");
const bookmarkletOutput = document.getElementById("bookmarkletOutput");
const copyBookmarkletButton = document.getElementById("copyBookmarkletButton");
const fillFromPayloadButton = document.getElementById("fillFromPayloadButton");
const captureInput = document.getElementById("captureInput");
const importCaptureButton = document.getElementById("importCaptureButton");
const captureResult = document.getElementById("captureResult");
const bulkImportInput = document.getElementById("bulkImportInput");
const bulkImportButton = document.getElementById("bulkImportButton");
const bulkImportSampleButton = document.getElementById("bulkImportSampleButton");
const bulkImportResult = document.getElementById("bulkImportResult");
const backendUrlInput = document.getElementById("backendUrlInput");
const syncNowButton = document.getElementById("syncNowButton");
const clearBackendButton = document.getElementById("clearBackendButton");
const backendStatus = document.getElementById("backendStatus");
const emailInput = document.getElementById("emailInput");
const emailResult = document.getElementById("emailResult");
const submitButton = document.getElementById("submitButton");

let applications = loadData(STORAGE_KEY, []);
let history = loadData(HISTORY_KEY, []);
let syncQueue = loadData(SYNC_QUEUE_KEY, []);
let editingId = null;

backendUrlInput.value = getBackendUrl();
updateBackendStatus();

seedIfEmpty();
bookmarkletOutput.value = buildBookmarklet();
runGhostingAutomation(false);
render();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = readFormValues();

  if (editingId) {
    applications = applications.map((application) => {
      if (application.id !== editingId) {
        return application;
      }

      const updated = {
        ...application,
        ...payload,
        updatedAt: new Date().toISOString(),
        lastUpdateDate: payload.lastUpdateDate || application.lastUpdateDate || payload.dateApplied,
      };

      appendHistory(application.id, application.stage, updated.stage, "manual update");
      return updated;
    });
  } else {
    const application = {
      id: crypto.randomUUID(),
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUpdateDate: payload.lastUpdateDate || payload.dateApplied,
      ghostedAt: null,
    };

    applications.unshift(application);
    appendHistory(application.id, null, application.stage, "created");
  }

  persist();
  queueFullSync("application saved");
  clearForm();
  render();
});

document.getElementById("resetButton").addEventListener("click", clearForm);
document.getElementById("seedButton").addEventListener("click", () => {
  applications = sampleApplications();
  history = [];
  applications.forEach((application) => {
    appendHistory(application.id, null, application.stage, "seeded sample");
  });
  persist();
  queueFullSync("seed data");
  render();
});

document.getElementById("runGhostingButton").addEventListener("click", () => {
  const changed = runGhostingAutomation(true);
  ghostingResult.textContent = changed ? `${changed} application(s) marked Ghosted.` : "No applications met the 14-day rule.";
  render();
});

backendUrlInput.addEventListener("change", () => {
  const nextUrl = backendUrlInput.value.trim();
  if (nextUrl) {
    localStorage.setItem(BACKEND_URL_KEY, nextUrl);
  } else {
    localStorage.removeItem(BACKEND_URL_KEY);
  }
  updateBackendStatus();
});

syncNowButton.addEventListener("click", async () => {
  await syncApplications();
});

clearBackendButton.addEventListener("click", () => {
  backendUrlInput.value = "";
  localStorage.removeItem(BACKEND_URL_KEY);
  syncQueue = [];
  persistSyncQueue();
  updateBackendStatus();
});

copyBookmarkletButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(bookmarkletOutput.value);
    captureResult.textContent = "Bookmarklet copied to clipboard.";
  } catch {
    captureResult.textContent = "Copy failed. Select the text and copy it manually.";
  }
});

fillFromPayloadButton.addEventListener("click", () => {
  captureInput.value = JSON.stringify(
    {
      company: "Northstar Studio",
      position: "Product Designer",
      location: "Remote",
      salary: "$135k-$155k",
      dateApplied: new Date().toISOString().slice(0, 10),
      stage: "Applied",
      sourceSite: "Greenhouse",
      link: "https://example.com/jobs/northstar-designer",
      recruiter: "Mia Chen",
      tags: ["design", "remote"],
      notes: "Sample capture payload from a job posting page."
    },
    null,
    2
  );
});

importCaptureButton.addEventListener("click", () => {
  const payload = parseCapturePayload(captureInput.value);
  if (!payload) {
    captureResult.textContent = "Could not read that payload. Paste JSON from the bookmarklet or a job posting URL summary.";
    return;
  }

  populateForm(payload);
  captureResult.textContent = `Loaded ${payload.company || "job details"} into the form.`;
});

bulkImportButton.addEventListener("click", () => {
  handleBulkImport();
});

async function handleBulkImport() {
  const raw = bulkImportInput.value || "";
  const urls = (raw || "").match(/https?:\/\/[^\s]+/g) || [];

  let fetchedJobs = [];
  const backendUrl = getBackendUrl();
  if (urls.length && backendUrl) {
    try {
      fetchedJobs = await fetchJobsFromBackend(urls);
    } catch (err) {
      bulkImportResult.innerHTML = `<strong>Error fetching URLs:</strong> ${escapeHtml(err.message || String(err))}`;
      return;
    }
  } else if (urls.length && !backendUrl) {
    bulkImportResult.innerHTML = '<strong>URL import requires a backend.</strong> Set the Backend URL above and try again.';
    return;
  }

  // Merge fetched jobs into a single raw text blob as JSON blocks so parser can handle them
  let combinedRaw = raw;
  if (fetchedJobs.length) {
    const jsonBlocks = fetchedJobs
      .map((j) => JSON.stringify(j, null, 2))
      .join("\n\n");
    combinedRaw = `${jsonBlocks}\n\n${raw}`.trim();
  }

  const report = importAppliedJobs(combinedRaw);
  bulkImportResult.innerHTML = report.html;
  if (report.added) {
    persist();
    queueFullSync("bulk import");
    render();
  }
});

bulkImportSampleButton.addEventListener("click", () => {
  bulkImportInput.value = [
    "Northstar Studio",
    "Product Designer",
    "Remote",
    "2026-07-24",
    "",
    "Trailhead Systems",
    "Frontend Engineer",
    "New York, NY",
    "2026-07-18",
    "",
    "Vector Health",
    "Data Analyst",
    "Hybrid - Seattle",
    "2026-07-21",
  ].join("\n");
});

document.getElementById("classifyEmailButton").addEventListener("click", () => {
  const report = classifyEmail(emailInput.value);
  emailResult.innerHTML = report.html;

  if (report.matches.length) {
    report.matches.forEach((match) => {
      history.unshift({
        id: crypto.randomUUID(),
        applicationId: match.application.id,
        fromStage: match.previousStage,
        toStage: match.nextStage,
        reason: `email: ${report.kind}`,
        createdAt: new Date().toISOString(),
      });
    });
    persist();
    queueFullSync("email update");
    render();
  }
});

document.getElementById("sampleEmailButton").addEventListener("click", () => {
  emailInput.value = "Subject: Interview next steps\n\nHi there, we'd like to invite you to a final interview for the Senior Product Designer role at Acme Labs. Please reply with your availability.";
});

searchInput.addEventListener("input", render);
stageFilter.addEventListener("change", render);

function readFormValues() {
  const data = new FormData(form);
  return {
    company: String(data.get("company") || "").trim(),
    position: String(data.get("position") || "").trim(),
    location: String(data.get("location") || "").trim(),
    link: String(data.get("link") || "").trim(),
    salary: String(data.get("salary") || "").trim(),
    sourceSite: String(data.get("sourceSite") || "").trim(),
    dateApplied: String(data.get("dateApplied") || "").trim(),
    stage: String(data.get("stage") || "Applied"),
    interviewDate: String(data.get("interviewDate") || "").trim(),
    recruiter: String(data.get("recruiter") || "").trim(),
    priority: String(data.get("priority") || "Medium"),
    tags: String(data.get("tags") || "").trim(),
    notes: String(data.get("notes") || "").trim(),
    lastUpdateDate: String(data.get("interviewDate") || data.get("dateApplied") || "").trim(),
  };
}

function populateForm(payload) {
  const fields = {
    company: payload.company,
    position: payload.position,
    location: payload.location,
    link: payload.link,
    salary: payload.salary,
    sourceSite: payload.sourceSite,
    dateApplied: payload.dateApplied || new Date().toISOString().slice(0, 10),
    stage: payload.stage || "Applied",
    interviewDate: payload.interviewDate,
    recruiter: payload.recruiter,
    priority: payload.priority || "Medium",
    tags: Array.isArray(payload.tags) ? payload.tags.join(", ") : payload.tags,
    notes: payload.notes,
  };

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    const input = form.elements.namedItem(key);
    if (input) {
      input.value = String(value);
    }
  });

  editingId = null;
  submitButton.textContent = "Add application";
}

function clearForm() {
  form.reset();
  editingId = null;
  submitButton.textContent = "Add application";
  form.querySelector('[name="stage"]').value = "Applied";
  form.querySelector('[name="priority"]').value = "Medium";
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedStage = stageFilter.value;

  const filtered = applications.filter((application) => {
    const haystack = [
      application.company,
      application.position,
      application.location,
      application.sourceSite,
      application.tags,
      application.notes,
      application.recruiter,
    ]
      .join(" ")
      .toLowerCase();

    const stageMatches = selectedStage === "All" || application.stage === selectedStage;
    const textMatches = !query || haystack.includes(query);
    return stageMatches && textMatches;
  });

  tableBody.innerHTML = filtered
    .map((application) => {
      const stageClass = `stage-${slugify(application.stage)}`;
      return `
        <tr>
          <td>
            <strong>${escapeHtml(application.company)}</strong><br />
            <span class="small-note">${escapeHtml(application.priority || "Medium")} priority</span>
          </td>
          <td>
            <strong>${escapeHtml(application.position)}</strong><br />
            <span class="small-note">${escapeHtml(application.sourceSite || "Manual")}</span>
          </td>
          <td class="table-stage ${stageClass}">${escapeHtml(application.stage)}</td>
          <td>${formatDate(application.dateApplied)}</td>
          <td>${formatDate(application.interviewDate)}</td>
          <td>${escapeHtml(application.location || "-")}</td>
          <td>${application.link ? `<a href="${escapeAttribute(application.link)}" target="_blank" rel="noreferrer">Open</a>` : "-"}</td>
          <td>
            <div class="row-actions">
              <button class="secondary" data-edit="${application.id}">Edit</button>
              <button class="ghost danger" data-delete="${application.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  if (!filtered.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8">
          <strong>No applications match the current filters.</strong><br />
          <span class="small-note">Try a different search, or add a new application.</span>
        </td>
      </tr>
    `;
  }

  tableBody.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => startEdit(button.getAttribute("data-edit") || ""));
  });

  tableBody.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteApplication(button.getAttribute("data-delete") || ""));
  });

  updateStats();
  lastSyncLabel.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function updateStats() {
  const open = applications.filter((application) => !["Rejected", "Ghosted", "Withdrawn", "Offer"].includes(application.stage)).length;
  const ghosted = applications.filter((application) => application.stage === "Ghosted").length;
  const interviews = applications.filter((application) => application.stage === "Interviewing" || application.interviewDate).length;
  const offers = applications.filter((application) => application.stage === "Offer").length;

  openCount.textContent = String(open);
  ghostedCount.textContent = String(ghosted);
  interviewCount.textContent = String(interviews);
  offerCount.textContent = String(offers);
}

function startEdit(id) {
  const application = applications.find((item) => item.id === id);
  if (!application) {
    return;
  }

  editingId = id;
  submitButton.textContent = "Save changes";

  Object.entries(application).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (input && typeof value === "string") {
      input.value = value;
    }
  });

  form.elements.namedItem("dateApplied").value = application.dateApplied || "";
  form.elements.namedItem("interviewDate").value = application.interviewDate || "";
}

function deleteApplication(id) {
  const target = applications.find((application) => application.id === id);
  if (!target) {
    return;
  }

  if (!window.confirm(`Delete ${target.company} - ${target.position}?`)) {
    return;
  }

  applications = applications.filter((application) => application.id !== id);
  history = history.filter((entry) => entry.applicationId !== id);
  persist();
  queueFullSync("delete");
  render();
}

function appendHistory(applicationId, fromStage, toStage, reason) {
  history.unshift({
    id: crypto.randomUUID(),
    applicationId,
    fromStage,
    toStage,
    reason,
    createdAt: new Date().toISOString(),
  });
}

function runGhostingAutomation(showHistory = true) {
  const today = new Date();
  let changed = 0;

  applications = applications.map((application) => {
    if (["Interviewing", "Offer", "Rejected", "Withdrawn", "Ghosted"].includes(application.stage)) {
      return application;
    }

    const anchor = application.lastUpdateDate || application.dateApplied;
    if (!anchor) {
      return application;
    }

    const ageInDays = Math.floor((today.getTime() - new Date(anchor).getTime()) / 86400000);
    if (ageInDays < GHOST_DAYS) {
      return application;
    }

    changed += 1;
    if (showHistory) {
      appendHistory(application.id, application.stage, "Ghosted", "14-day automation");
    }

    return {
      ...application,
      stage: "Ghosted",
      ghostedAt: today.toISOString(),
      updatedAt: today.toISOString(),
    };
  });

  if (changed) {
    persist();
    queueFullSync("ghosting automation");
  }

  return changed;
}

function classifyEmail(rawText) {
  const text = rawText.trim();
  if (!text) {
    return {
      kind: "empty",
      matches: [],
      html: "Paste an email subject or body to classify it.",
    };
  }

  const lowered = text.toLowerCase();
  const kind = detectEmailKind(lowered);
  const companyMatches = applications.filter((application) => lowered.includes(application.company.toLowerCase()));

  const stageByKind = {
    rejection: "Rejected",
    interview: "Interviewing",
    offer: "Offer",
    reminder: "Applied",
    unknown: "Applied",
  }[kind];

  const matches = companyMatches.map((application) => {
    const nextStage = stageByKind;
    const previousStage = application.stage;
    if (previousStage !== nextStage) {
      application.stage = nextStage;
      application.lastUpdateDate = new Date().toISOString().slice(0, 10);
      application.updatedAt = new Date().toISOString();
    }

    return { application, previousStage, nextStage };
  });

  const reviewTone = matches.length ? `${matches.length} application(s) matched and were updated to ${stageByKind}.` : "No application names were detected in the message. Treat this as a review item.";
  const html = `
    <strong>${labelForKind(kind)}</strong><br />
    ${escapeHtml(reviewTone)}<br />
    <span class="small-note">Matched companies: ${matches.length ? matches.map((match) => match.application.company).join(", ") : "none"}</span>
  `;

  if (matches.length) {
    persist();
  }

  return { kind, matches, html };
}

function detectEmailKind(loweredText) {
  if (/(interview|schedule a call|availability|meet the team|final round|next steps)/i.test(loweredText)) {
    return "interview";
  }

  if (/(offer|congratulations|compensation|salary discussion|we are pleased)/i.test(loweredText)) {
    return "offer";
  }

  if (/(rejected|regret|not moving forward|unfortunately|unable to proceed|thank you for applying)/i.test(loweredText)) {
    return "rejection";
  }

  if (/(follow up|still interested|checking in|bump|reminder)/i.test(loweredText)) {
    return "reminder";
  }

  return "unknown";
}

function labelForKind(kind) {
  return {
    interview: "Interview offer detected",
    offer: "Offer detected",
    rejection: "Rejection detected",
    reminder: "Follow-up signal detected",
    unknown: "Unclear message",
    empty: "No message provided",
  }[kind] || "Unknown";
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function persistSyncQueue() {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
}

function getBackendUrl() {
  return localStorage.getItem(BACKEND_URL_KEY) || "";
}

function updateBackendStatus(message) {
  const backendUrl = getBackendUrl();
  const pendingCount = syncQueue.length;

  if (message) {
    backendStatus.textContent = message;
    return;
  }

  if (!backendUrl) {
    backendStatus.textContent = "No backend configured. Local storage only.";
    return;
  }

  backendStatus.textContent = pendingCount
    ? `${pendingCount} change(s) waiting for sync to ${backendUrl}.`
    : `Connected to ${backendUrl}. All changes are synced.`;
}

function queueFullSync(reason) {
  syncQueue.unshift({
    id: crypto.randomUUID(),
    type: "replace-all",
    reason,
    queuedAt: new Date().toISOString(),
  });

  persistSyncQueue();
  updateBackendStatus(`${reason} queued for backend sync.`);
  syncApplications().catch((error) => {
    updateBackendStatus(`Sync queued but not sent yet: ${error.message}`);
  });
}

async function syncApplications() {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    updateBackendStatus("No backend configured. Local storage only.");
    return;
  }

  if (!applications.length) {
    updateBackendStatus(`Connected to ${backendUrl}. Nothing to sync.`);
    return;
  }

  const payload = {
    applications,
    history,
    syncedAt: new Date().toISOString(),
  };

  const response = await fetch(new URL("/sync", backendUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Backend responded with ${response.status}`);
  }

  syncQueue = [];
  persistSyncQueue();
  updateBackendStatus(`Synced ${applications.length} applications to ${backendUrl}.`);
}

function buildBookmarklet() {
  return `javascript:(${bookmarkletRunner.toString()})()`;
}

function bookmarkletRunner() {
  (async function () {
    const getMeta = function (names) {
      for (const name of names) {
        const element = document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]');
        if (element && element.content && element.content.trim()) {
          return element.content.trim();
        }
      }

      return '';
    };

    const readText = function (element) {
      return element ? (element.innerText || element.textContent || '').trim() : '';
    };

    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .flatMap(function (element) {
        try {
          const parsed = JSON.parse(element.textContent);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      })
      .find(function (item) {
        return item && typeof item === 'object' && (item.title || item.hiringOrganization || item.employer || item.jobLocation || item.baseSalary);
      });

    const company =
      (jsonLd && jsonLd.hiringOrganization && jsonLd.hiringOrganization.name) ||
      (jsonLd && jsonLd.hiringOrganization) ||
      (jsonLd && jsonLd.employer && jsonLd.employer.name) ||
      getMeta(['og:site_name']) ||
      getMeta(['application-name']) ||
      location.hostname.replace(/^www\./, '');

    const position = ((jsonLd && jsonLd.title) || readText(document.querySelector('h1')) || document.title || '').replace(/\s*[-|].*$/, '').trim();

    const locationText = Array.isArray(jsonLd && jsonLd.jobLocation)
      ? jsonLd.jobLocation
          .map(function (item) {
            return item && item.address && (item.address.addressLocality || item.address.addressRegion || item.address.streetAddress);
          })
          .filter(Boolean)
          .join(', ')
      : (jsonLd && jsonLd.jobLocation && jsonLd.jobLocation.address && (jsonLd.jobLocation.address.addressLocality || jsonLd.jobLocation.address.addressRegion || jsonLd.jobLocation.address.streetAddress)) ||
        getMeta(['jobLocation']);

    const salary =
      jsonLd && jsonLd.baseSalary && jsonLd.baseSalary.value && jsonLd.baseSalary.value.minValue && jsonLd.baseSalary.value.maxValue
        ? '$' + jsonLd.baseSalary.value.minValue + '-$' + jsonLd.baseSalary.value.maxValue
        : (jsonLd && jsonLd.baseSalary && jsonLd.baseSalary.value && (jsonLd.baseSalary.value.value || jsonLd.baseSalary.value)) || '';

    const payload = {
      company: company,
      position: position,
      location: locationText || '',
      salary: salary,
      link: location.href,
      sourceSite: location.hostname.replace(/^www\./, ''),
      dateApplied: new Date().toISOString().slice(0, 10),
      stage: 'Applied',
      notes: [readText(document.querySelector('main')), readText(document.body)].join('\n\n').slice(0, 1200),
    };

    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    alert('Job details copied. Paste them into Job Tracker.');
  })().catch(function (error) {
    alert('Could not capture job details: ' + error.message);
  });
}

function parseCapturePayload(rawText) {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  try {
    const payload = JSON.parse(text);
    return normalizeCapturePayload(payload);
  } catch {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return null;
    }

    const guessed = {
      company: lines[0] || "",
      position: lines[1] || "",
      location: lines.find((line) => /remote|hybrid|\b[a-z]+,\s*[a-z]{2}\b/i.test(line)) || "",
      salary: lines.find((line) => /\$\d|salary|compensation/i.test(line)) || "",
      link: lines.find((line) => /^https?:\/\//i.test(line)) || "",
      notes: text.slice(0, 1200),
    };

    return normalizeCapturePayload(guessed);
  }
}

function normalizeCapturePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const tags = Array.isArray(payload.tags) ? payload.tags : String(payload.tags || "").split(/[,;]+/).map((item) => item.trim()).filter(Boolean);

  return {
    company: String(payload.company || payload.companyName || payload.employer || "").trim(),
    position: String(payload.position || payload.title || payload.role || "").trim(),
    location: String(payload.location || payload.jobLocation || payload.city || "").trim(),
    salary: String(payload.salary || payload.compensation || "").trim(),
    link: String(payload.link || payload.url || payload.jobUrl || "").trim(),
    sourceSite: String(payload.sourceSite || payload.site || payload.source || location.hostname).trim(),
    dateApplied: String(payload.dateApplied || new Date().toISOString().slice(0, 10)).trim(),
    stage: String(payload.stage || "Applied"),
    interviewDate: String(payload.interviewDate || "").trim(),
    recruiter: String(payload.recruiter || payload.recruiterName || "").trim(),
    priority: String(payload.priority || "Medium"),
    tags,
    notes: String(payload.notes || payload.description || "").trim(),
  };
}

function importAppliedJobs(rawText) {
  const text = rawText.trim();
  if (!text) {
    return {
      added: 0,
      html: "Paste a list from Indeed or another applied-jobs view to import it.",
    };
  }

  const parsed = parseAppliedJobBlocks(text);
  if (!parsed.length) {
    return {
      added: 0,
      html: "Could not identify any jobs in that text. Try pasting one job per block with company, title, and location on separate lines.",
    };
  }

  let added = 0;
  let skipped = 0;

  parsed.forEach((candidate) => {
    if (!candidate.company || !candidate.position) {
      skipped += 1;
      return;
    }

    if (applications.some((application) => isDuplicateApplication(application, candidate))) {
      skipped += 1;
      return;
    }

    const record = {
      id: crypto.randomUUID(),
      ...candidate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUpdateDate: candidate.lastUpdateDate || candidate.dateApplied,
      ghostedAt: candidate.stage === "Ghosted" ? new Date().toISOString() : null,
    };

    applications.unshift(record);
    appendHistory(record.id, null, record.stage, "bulk import");
    added += 1;
  });

  return {
    added,
    html: `<strong>${added} job(s) imported.</strong><br /><span class="small-note">Skipped ${skipped} duplicate or incomplete item(s).</span>`,
  };
}

function parseAppliedJobBlocks(rawText) {
  const chunks = rawText
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const sourceBlocks = chunks.length > 1 ? chunks : [rawText.trim()];
  return sourceBlocks
    .map((block) => parseAppliedJobBlock(block))
    .filter(Boolean);
}

function parseAppliedJobBlock(block) {
  const text = block.trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeAppliedJob(item)).filter(Boolean)[0] || null;
    }

    return normalizeAppliedJob(parsed);
  } catch {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean);

    if (!lines.length) {
      return null;
    }

    const urls = lines.filter((line) => /^https?:\/\//i.test(line));
    const dateLine = lines.find((line) => /^\d{4}-\d{2}-\d{2}$/.test(line) || /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(line));
    const remaining = lines.filter((line) => line !== dateLine && !/^https?:\/\//i.test(line));

    const combined = remaining.join(" | ");
    const segments = combined
      .split(/\s+[•|]\s+|\s*\t\s*|\s+-\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const company = segments[0] || remaining[0] || "";
    const position = segments[1] || remaining[1] || "";
    const location = pickLocation(segments.slice(2).concat(remaining.slice(2)));

    return normalizeAppliedJob({
      company,
      position,
      location,
      link: urls[0] || "",
      sourceSite: "Indeed",
      dateApplied: dateLine || new Date().toISOString().slice(0, 10),
      stage: "Applied",
      notes: text.slice(0, 1200),
    });
  }
}

function normalizeAppliedJob(payload) {
  const normalized = normalizeCapturePayload(payload);
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    sourceSite: normalized.sourceSite || "Indeed",
    stage: normalized.stage || "Applied",
    dateApplied: normalized.dateApplied || new Date().toISOString().slice(0, 10),
  };
}

async function fetchJobsFromBackend(urls) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) throw new Error("No backend configured");

  const response = await fetch(new URL("/fetch-jobs", backendUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });

  if (!response.ok) {
    throw new Error(`Backend responded with ${response.status}`);
  }

  const body = await response.json();
  if (!body || !Array.isArray(body.jobs)) {
    throw new Error("Invalid response from backend");
  }

  // Map backend job entries to normalized applied job objects
  const jobs = body.jobs
    .filter((entry) => entry && entry.ok && entry.job)
    .map((entry) => normalizeAppliedJob(entry.job))
    .filter(Boolean);

  return jobs;
}

function pickLocation(values) {
  const candidate = values.find((line) => /remote|hybrid|\b[a-z .'-]+,\s*[a-z]{2}\b/i.test(line) || /\b[a-z]+\s+[a-z]+\b/i.test(line));
  return candidate || "";
}

function isDuplicateApplication(existing, candidate) {
  return (
    existing.company.trim().toLowerCase() === candidate.company.trim().toLowerCase() &&
    existing.position.trim().toLowerCase() === candidate.position.trim().toLowerCase() &&
    (existing.link || "").trim().toLowerCase() === (candidate.link || "").trim().toLowerCase() &&
    (existing.dateApplied || "").trim() === (candidate.dateApplied || "").trim()
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
function loadData(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function seedIfEmpty() {
  if (!applications.length) {
    applications = sampleApplications();
    applications.forEach((application) => appendHistory(application.id, null, application.stage, "seeded sample"));
    persist();
  }
}

function sampleApplications() {
  const today = new Date();
  const daysAgo = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };

  return [
    {
      id: crypto.randomUUID(),
      company: "Northstar Studio",
      position: "Product Designer",
      location: "Remote",
      link: "https://example.com/jobs/northstar-designer",
      salary: "$135k-$155k",
      sourceSite: "Greenhouse",
      dateApplied: daysAgo(4),
      stage: "Interviewing",
      interviewDate: daysAgo(1),
      recruiter: "Mia Chen",
      priority: "High",
      tags: "design, remote, portfolio",
      notes: "Second round completed; waiting on take-home feedback.",
      lastUpdateDate: daysAgo(1),
      ghostedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      company: "Trailhead Systems",
      position: "Frontend Engineer",
      location: "New York, NY",
      link: "https://example.com/jobs/trailhead-fe",
      salary: "$150k-$180k",
      sourceSite: "LinkedIn",
      dateApplied: daysAgo(19),
      stage: "Ghosted",
      interviewDate: "",
      recruiter: "",
      priority: "Medium",
      tags: "react, frontend, remote",
      notes: "No response after application submission.",
      lastUpdateDate: daysAgo(19),
      ghostedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      company: "Vector Health",
      position: "Data Analyst",
      location: "Hybrid - Seattle",
      link: "https://example.com/jobs/vector-analyst",
      salary: "$110k-$130k",
      sourceSite: "Company site",
      dateApplied: daysAgo(9),
      stage: "Applied",
      interviewDate: "",
      recruiter: "Jordan Lee",
      priority: "Low",
      tags: "analytics, healthtech",
      notes: "Referral from former teammate.",
      lastUpdateDate: daysAgo(9),
      ghostedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
