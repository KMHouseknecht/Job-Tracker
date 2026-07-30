# Job Tracker API Contract

The tracker can sync to any backend that accepts the following JSON shape.

## Create or update application

POST /sync

```json
{
  "syncedAt": "2026-07-30T10:24:00.000Z",
  "applications": [
    {
      "company": "Northstar Studio",
      "position": "Product Designer",
      "location": "Remote",
      "salary": "$135k-$155k",
      "link": "https://example.com/jobs/northstar-designer",
      "sourceSite": "Greenhouse",
      "dateApplied": "2026-07-30",
      "stage": "Applied",
      "interviewDate": "",
      "recruiter": "Mia Chen",
      "priority": "Medium",
      "tags": ["design", "remote"],
      "notes": "Sample job posting capture"
    }
  ],
  "history": []
}
```

## Suggested backend responsibilities

- Store applications and change history
- Accept full-list syncs from the tracker UI and extension
- Return a list of applications for sync
- Accept webhook or polling updates from email automation later
- Track a `lastSyncedAt` or `updatedAt` timestamp for conflict handling
