# Vigil: installation and testing instructions for judges

> These are the testing instructions written for the Codegeist 2026 judges. To try the app yourself, first deploy your own copy (see the README). Where a step mentions the installation link from the submission form, use `forge install` on your own site instead, and replace `<your-app-id>` with the app ID that `forge register` gave you.

Vigil shows the regulatory reporting clocks of medical device complaints in Jira (FDA 21 CFR Part 803 and EU MDR Article 87), reads complaints with a Rovo agent, and checks the product's risk management file through the Teamwork Graph API.

## Requirements

- A Jira and Confluence Cloud site where you are an organization admin. The Teamwork Graph scopes need organization admin consent at install.
- Rovo enabled, for the agent. The panel, the Vigilance page, the manual assessment form and the reminders work without it.
- About 15 minutes.

## 1. Install

1. Open the installation link from the submission form and choose your site.
2. Install into **Jira** first (the required app), then connect **Confluence** (optional app, same link).
3. Approve the requested scopes:
   - `read:jira-work`, `write:jira-work`: read complaints, and add a reminder comment when a report is due soon.
   - `read:page:confluence`, `write:page:confluence`, `read:space:confluence`: read the risk management file, and write a decision record page when you ask for one.
   - `storage:app`: store assessments and product settings inside the app.
   - `read:graph:issue:jira`, `read:graph:issue-comment:jira`, `read:graph:page:confluence`, `read:graph:user:atlassian`: Teamwork Graph curated queries for complaint comments, linked pages and page owners, always as the current user.

Vigil calls no external services. Reasoning runs in Rovo.

## 2. Prepare the demo data (5 minutes)

1. **Confluence.** In any space, create these pages:
   - **"Hazard analysis"**, with a line such as: "H-02: downstream occlusion not detected. Harm: interruption of insulin therapy, hyperglycaemia and diabetic ketoacidosis."
   - **"Risk management file"**, with a link to the Hazard analysis page. Insert the link with Confluence's link tool, so Teamwork Graph sees it.
2. **Jira.** Create a project, for example **Complaints**. Note its key, such as CMP.
3. **Vigil settings.** Open **Apps > Vigilance > Add a product** and set:
   - product key FB-20;
   - Jira project CMP;
   - markets: United States and European Union;
   - risk management file: the page link or ID;
   - space for decision records: the space key;
   - problem codes: `false-occlusion-alarm | False occlusion alarm | 0.5 | 30`.

   Only project admins can save settings.
4. **A serious complaint.** In the project, create a work item **"No occlusion alarm: insulin infusion stopped, patient moved to ICU"** with the description "The pump did not alarm when the line was occluded. The patient developed diabetic ketoacidosis and was transferred to intensive care." Then add this comment, using the date 13 days before today: "Sales rep: the nurse manager called me about this on *(date 13 days before today)*."

## 3. Reporting clocks before assessment

Open the work item and, under the title, open **Apps > Reporting clocks**. The panel shows "No reportability decision yet". It shows two clocks counted from today, the day the work item was created: FDA 30-day MDR and EU serious incident report. It also warns that day 0 may be earlier.

## 4. Assess with Rovo

1. Click **Assess with Rovo**, or open Rovo, choose the **Vigil** agent and say "Assess this complaint for reportability".
2. Vigil proposes day 0 from the sales rep's comment (13 days ago) with the quote. It answers each criterion with evidence. For "unanticipated", it should cite hazard H-02 from the hazard analysis it found through the risk management file.
3. Reply "Confirmed. Record it.", then click **Confirm selected** in Rovo's review card.
4. Expected result:
   - **EU serious incident report** due 15 days after day 0, so in 2 days (MDR Art. 87(3)). If day 15 falls on a weekend, the reason text explains the extension.
   - **FDA 30-day MDR** due 30 days after day 0 (21 CFR 803.50(a)).

   The panel now shows "Due in 2 days", the confirmed facts with quotes, and the line "Anticipated in the risk assessment ... EU limit 15 days, not 10". The risk management file section is marked "from Teamwork Graph".

## 5. Reminder comment

Add any comment to the complaint. Within about a minute, Vigil comments that the EU report is due in 2 days and quotes the rule. It comments once per clock and stage, so another comment does not repeat it.

## 6. Five work days

Create another work item: "Flow rate 10% high after firmware update". Add a comment: "Engineering manager, today: root cause confirmed; over-delivery of insulin could cause serious harm. We need a field correction for all pumps." Ask Vigil to assess it and confirm. Expected result:
- an **FDA 5-day report** due 5 work days after today. The reason lists the weekend days and US federal holidays it did not count;
- an EU report due in 15 days, because the malfunction might lead to serious harm.

## 7. Record a report

In the panel of that complaint, click **Record a report**, choose **FDA initial report**, enter any reference and click **Record**. The FDA clock becomes **Submitted**, and a **New information** button appears. It starts the 30-day supplemental clock of 21 CFR 803.56.

## 8. Vigilance page and trends

1. Create three quick work items with the label `false-occlusion-alarm`, for example "False occlusion alarm, no harm".
2. Open **Apps > Vigilance**. It shows:
   - the open clocks, the reports due in the next 14 days, and complaints that need an assessment;
   - a **trend signal**: 3 incidents in 30 days against 0.5 expected gives p = 0.014 in a one-sided Poisson test (MDR Art. 88).

## 9. Decision record

In the first complaint's panel, click **Write decision record**, or ask the agent. Vigil creates a Confluence page in the space you set, with the facts, the evidence, the clocks and the rationale.

## Privacy

- Every read for people runs as the current user, and Teamwork Graph results are filtered to what that user can see.
- Vigil stores the following in Forge storage on your site: complaint keys, dates, confirmed answers, short evidence quotes from the complaint, the rationale, the dates and references of reports that were sent, and product settings. It does not store account IDs, people's names or email addresses.
- Vigil is decision support. It does not replace a complaint handling procedure and does not submit reports to any authority.
