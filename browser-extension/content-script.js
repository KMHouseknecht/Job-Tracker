function readMeta(names) {
  for (const name of names) {
    const element = document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]');
    if (element && element.content && element.content.trim()) {
      return element.content.trim();
    }
  }
  return '';
}

function readText(element) {
  return element ? (element.innerText || element.textContent || '').trim() : '';
}

function readJobPayload() {
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((element) => {
      try {
        const parsed = JSON.parse(element.textContent);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    })
    .find((item) => item && typeof item === 'object' && (item.title || item.hiringOrganization || item.employer || item.jobLocation || item.baseSalary));

  const company =
    jsonLd?.hiringOrganization?.name ||
    jsonLd?.hiringOrganization ||
    jsonLd?.employer?.name ||
    readMeta(['og:site_name']) ||
    readMeta(['application-name']) ||
    location.hostname.replace(/^www\./, '');

  const position = ((jsonLd?.title || readText(document.querySelector('h1')) || document.title || '')).replace(/\s*[-|].*$/, '').trim();

  const locationText = Array.isArray(jsonLd?.jobLocation)
    ? jsonLd.jobLocation
        .map((item) => item?.address?.addressLocality || item?.address?.addressRegion || item?.address?.streetAddress)
        .filter(Boolean)
        .join(', ')
    : jsonLd?.jobLocation?.address?.addressLocality || jsonLd?.jobLocation?.address?.addressRegion || jsonLd?.jobLocation?.address?.streetAddress || readMeta(['jobLocation']);

  const salary =
    jsonLd?.baseSalary?.value?.minValue && jsonLd?.baseSalary?.value?.maxValue
      ? '$' + jsonLd.baseSalary.value.minValue + '-$' + jsonLd.baseSalary.value.maxValue
      : jsonLd?.baseSalary?.value?.value || jsonLd?.baseSalary?.value || '';

  return {
    company,
    position,
    location: locationText || '',
    salary,
    link: location.href,
    sourceSite: location.hostname.replace(/^www\./, ''),
    dateApplied: new Date().toISOString().slice(0, 10),
    stage: 'Applied',
    notes: [readText(document.querySelector('main')), readText(document.body)].join('\n\n').slice(0, 1200),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'JOB_TRACKER_CAPTURE') {
    return;
  }

  try {
    sendResponse({ ok: true, payload: readJobPayload() });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }

  return true;
});
