# Job Application Tracker Data Model

## Core record

- Company
- Position
- Location
- Job link
- Salary
- Date applied
- Current stage
- Interview date
- Recruiter contact
- Source site
- Priority
- Tags
- Notes
- Last update date
- Ghosted date
- Created timestamp
- Updated timestamp

## Suggested lifecycle

- Applied
- Screening
- Interviewing
- Offer
- Rejected
- Ghosted
- Withdrawn

## Automation rules

1. Mark any application as Ghosted if it has no update after 14 days and is not already in Interviewing, Offer, Rejected, or Withdrawn.
2. Preserve the prior stage in history when automation changes a record.
3. Classify inbox messages conservatively and route uncertain matches to review rather than silently updating a record.
