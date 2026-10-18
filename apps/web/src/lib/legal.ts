// The text of the Terms of Service and the Privacy Policy. Details PS Tech
// has not yet confirmed are written as {{to be confirmed: what}} and show as
// marked gaps on the page, so nothing is stated that has not been checked.

export type Block =
  | { p: string }
  | { h: string }
  | { ul: string[] }
  | { table: { head: string[]; rows: string[][] } };

export interface Section {
  title: string;
  blocks: Block[];
}

export interface LegalDoc {
  title: string;
  version: string;
  effective: string;
  intro?: string;
  sections: Section[];
}

const p = (s: string): Block => ({ p: s });

export const TERMS: LegalDoc = {
  title: "HealthFlow Terms of Service",
  version: "1.0 (draft)",
  effective: "{{to be confirmed: effective date}}",
  sections: [
    {
      title: "Who these terms are between",
      blocks: [
        p("These terms form an agreement between **PS Tech**, {{to be confirmed: registration status}}, of {{to be confirmed: registered address}}, Ghana (\"PS Tech\", \"we\", \"us\"), and the health facility or organisation that subscribes to HealthFlow (\"the Facility\", \"you\")."),
        p("By creating an account, or by using HealthFlow, you agree to these terms. If you are agreeing on behalf of a facility, you confirm you are authorised to do so."),
      ],
    },
    {
      title: "What HealthFlow is",
      blocks: [
        p("HealthFlow is a subscription web application for managing staff duty rosters, leave, attendance and related workforce operations in health facilities."),
        p("**HealthFlow is not a clinical system.** It holds no patient records, no clinical notes, no diagnoses and no prescriptions. It provides no clinical decision support and is not a medical device."),
        p("**HealthFlow is not a legal service.** It computes working hours and rest periods against limits you configure, and reports what appears to breach them. The limits it ships with are drawn from published summaries of the Labour Act 2003 (Act 651) and are a starting point for you to confirm. **You remain responsible for the lawfulness of your rosters and for compliance with your own obligations as an employer.** We are not your legal adviser."),
      ],
    },
    {
      title: "Your account",
      blocks: [
        p("You are responsible for the accounts you create, for the people you give access to, and for the accuracy of the information entered."),
        p("You must keep account credentials confidential, use two-step sign-in where we require it, and tell us promptly if you believe an account has been compromised."),
        p("You must remove access for staff who leave your facility. The system assists with this, but the responsibility is yours."),
      ],
    },
    {
      title: "What you may and may not do",
      blocks: [
        p("You may use HealthFlow for managing your own facility's workforce."),
        p("You may not use it to store patient information or clinical records; attempt to access another facility's data; attempt to get around access controls; resell or sublicense access without our written agreement; use it unlawfully; or reverse engineer, copy or create a competing product from it."),
      ],
    },
    {
      title: "Data protection",
      blocks: [
        p("Personal data of your staff is processed under the **Data Processing Agreement**, which forms part of these terms. {{to be confirmed: where the agreement is published}}"),
        p("In summary: you are the **data controller** for your staff's personal data. We are the **data processor**, acting on your documented instructions. Each of us is responsible for our own registration with the Data Protection Commission under the Data Protection Act 2012 (Act 843). Our [Privacy Policy](/privacy) explains more."),
      ],
    },
    {
      title: "Fees and payment",
      blocks: [
        p("Fees are those set out in your subscription, in Ghana cedis. Invoices are issued at the start of each billing period and are due within {{to be confirmed: payment period}} days."),
        p("We may change prices with 60 days' written notice. A price change does not take effect during a period you have already paid for."),
        p("If an invoice is more than {{to be confirmed: overdue period}} days overdue, we may suspend access to generation and editing after giving you 14 days' written notice. **Suspension does not delete your data, and does not prevent you from reading published rosters or exporting everything you own.** We will not withhold your data over an unpaid invoice."),
      ],
    },
    {
      title: "Availability and support",
      blocks: [
        p("We aim to keep HealthFlow available, but we do not guarantee uninterrupted service. We will give reasonable notice of planned maintenance."),
        p("Support is available by email and telephone during {{to be confirmed: support hours}}, with a target first response within {{to be confirmed: response time}}. Targets are commitments of intent, not contractual guarantees, unless a separate service level agreement is signed."),
      ],
    },
    {
      title: "Your data, and getting it back",
      blocks: [
        p("Your facility's data remains yours."),
        p("You may export all of it at any time, in structured spreadsheet formats, without charge and without asking us."),
        p("On termination for any reason, you may export your data for 30 days. We then delete it, including from backups on our ordinary backup cycle, within 90 days, and confirm the deletion in writing."),
      ],
    },
    {
      title: "Our intellectual property",
      blocks: [p("HealthFlow, meaning the software, its design and its documentation, belongs to PS Tech. These terms grant you a non-exclusive, non-transferable right to use it during your subscription. Nothing transfers ownership.")],
    },
    {
      title: "Confidentiality",
      blocks: [p("Each of us will keep the other's confidential information confidential and use it only for the purposes of this agreement.")],
    },
    {
      title: "Warranties and what we do not warrant",
      blocks: [
        p("We warrant that we will provide HealthFlow with reasonable skill and care."),
        p("Beyond that, HealthFlow is provided as it is. We do not warrant that it will be error-free, that it will meet every requirement, or that its outputs are legally sufficient for any particular purpose. **In particular, the compliance findings are an aid to judgement and not a legal determination.**"),
      ],
    },
    {
      title: "Limitation of liability",
      blocks: [
        p("Neither of us limits liability for death or personal injury caused by negligence, for fraud, or for anything that cannot lawfully be limited."),
        p("Subject to that, our total liability under this agreement in any twelve-month period is limited to the fees you paid in that period."),
        p("We are not liable for indirect or consequential loss, loss of profit, or loss arising from your own staffing decisions."),
      ],
    },
    {
      title: "Term and termination",
      blocks: [
        p("The agreement runs for your subscription period and renews unless either of us gives {{to be confirmed: notice period}} days' notice."),
        p("Either of us may terminate for material breach not remedied within 30 days of written notice."),
        p("We may suspend immediately where continued use would breach the law or risk others' data, and we will tell you why."),
      ],
    },
    {
      title: "Changes to these terms",
      blocks: [p("We may update these terms. For material changes we will give 30 days' notice and ask facility administrators to acknowledge the new version when they next sign in. If you do not accept a material change you may terminate before it takes effect and receive a pro-rata refund.")],
    },
    {
      title: "Law and disputes",
      blocks: [
        p("These terms are governed by the laws of the Republic of Ghana, and the courts of Ghana have jurisdiction."),
        p("Before either of us begins proceedings, we will each nominate a senior representative to attempt to resolve the dispute in good faith within 30 days."),
      ],
    },
    {
      title: "Notices",
      blocks: [p("Notices to us: muslimfroko05@gmail.com and {{to be confirmed: postal address}}. Notices to you: the email address of your registered facility administrator.")],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  title: "HealthFlow Privacy Policy",
  version: "1.0 (draft)",
  effective: "{{to be confirmed: effective date}}",
  sections: [
    {
      title: "Who we are",
      blocks: [
        p("HealthFlow is operated by **PS Tech**, {{to be confirmed: registration details}}, of {{to be confirmed: registered address}}, Ghana."),
        p("Registration with Ghana's Data Protection Commission as a data processor: {{to be confirmed: registration number}}."),
        p("Our data protection contact is reachable at **muslimfroko05@gmail.com** and **055 457 1800**."),
      ],
    },
    {
      title: "What this policy covers",
      blocks: [
        p("This policy explains how we handle personal data in three situations, which have different rules."),
        {
          table: {
            head: ["Situation", "Who the data is about", "Our role"],
            rows: [
              ["You visit this website", "Website visitors", "We are the controller"],
              ["Your facility subscribes", "The facility's administrators and contacts", "We are the controller"],
              ["Your facility uses HealthFlow", "The facility's staff", "The facility is the controller. We are the processor."],
            ],
          },
        },
        p("The third situation is the important one, and it is covered in section 5."),
      ],
    },
    {
      title: "When you visit this website",
      blocks: [
        p("We collect the pages visited, approximate location derived from your network address, and browser type. We use this only to understand how the site is used and to keep it working."),
        p("If you contact us, we collect the name, role, email, telephone number and facility details you give, and we use them to respond to you and to keep our record of enquiries. We keep them for {{to be confirmed: retention period}} months from our last contact, unless you ask us to remove them sooner."),
        p("We do not sell personal data. We do not use it for advertising. HealthFlow does not place tracking cookies on this site. The only cookie it sets is the one that keeps you signed in."),
      ],
    },
    {
      title: "When your facility subscribes",
      blocks: [
        p("We collect the facility's details, the names and contact details of its administrators and billing contact, and records of our correspondence, invoices and payments."),
        p("We use these to provide the service, to invoice you, to provide support, and to meet our own legal and accounting obligations. We keep them for the duration of the agreement and for {{to be confirmed: record retention}} years afterwards, as required for business records."),
      ],
    },
    {
      title: "Staff data inside HealthFlow",
      blocks: [
        p("When your facility uses HealthFlow, we process personal data about its staff. **In this situation your facility is the data controller and we are the data processor.** Your facility decides what is collected and why, and we act only on your facility's documented instructions, under the Data Processing Agreement."),
        { h: "What is held" },
        {
          ul: [
            "Identity and contact: name, staff number, telephone, email, address, emergency contact, and a photograph only where the staff member has consented",
            "Employment: cadre, department, position, employment type, status, date joined",
            "Operational: duty assignments, attendance, duty swaps",
            "Leave: leave type and dates",
          ],
        },
        { h: "Health-related data" },
        p("Leave records include sick leave and maternity leave. **A record that a named person took sick leave on a given date is information about that person's health**, and is treated as special personal data under the Data Protection Act 2012 (Act 843)."),
        p("**HealthFlow has no field anywhere for a diagnosis, a symptom, a condition or a medical note**, and we will not add one. Sickness is recorded as a leave type and a set of dates, nothing more."),
        { h: "Who can see it" },
        {
          ul: [
            "Staff see their own record and their own duties, and nobody else's.",
            "Facility administrators, roster managers and supervisors see what their role requires within their own facility.",
            "A district health directorate sees data only where your facility has explicitly granted it, limited to the categories granted, and never including photographs, telephone numbers, addresses or emergency contacts. Every such access is recorded in your facility's own audit log.",
            "No facility can see another facility's data.",
            "Our staff access facility data only when necessary for support, and every such access is logged and visible to the facility.",
          ],
        },
        { h: "How long it is kept" },
        p("Retention is set by your facility, not by us, from a schedule your facility approves. Our proposed defaults are: rosters, attendance and leave for six years; audit logs for seven years; notifications for twelve months. Records past their retention are deleted only after your facility confirms."),
      ],
    },
    {
      title: "Your rights",
      blocks: [
        p("Every person whose personal data is held has the right to be told what is held, to have inaccurate data corrected, to object to processing, to have data erased in some circumstances, and to receive a copy of their data in a portable format."),
        p("**If you are a member of staff at a facility using HealthFlow,** your facility is the controller and handles your requests, and we assist them. Ask your facility's in-charge for a copy of what is held about you."),
        p("**If you are a website visitor or a facility contact,** email **muslimfroko05@gmail.com** and we will respond within 14 days."),
        p("You also have the right to complain to the **Data Protection Commission** of Ghana."),
      ],
    },
    {
      title: "Who else processes the data",
      blocks: [
        p("We use the following services to run HealthFlow. Each may process data only to provide its service to us. Locations marked to be confirmed will be filled in before this policy takes effect."),
        {
          table: {
            head: ["Service", "What it does", "Where"],
            rows: [
              ["Render", "Runs the HealthFlow server", "{{to be confirmed: region}}"],
              ["Neon", "Holds the database", "{{to be confirmed: region}}"],
              ["Cloudflare", "Serves the website", "Global network"],
              ["Resend", "Sends system email, when switched on", "{{to be confirmed: region}}"],
            ],
          },
        },
        p("We give facilities written notice before adding or changing a service of this kind, and a facility may object."),
      ],
    },
    {
      title: "Where the data is held",
      blocks: [p("The database and the server are hosted by the services above, in {{to be confirmed: region}}. Where data is held outside Ghana, we rely on {{to be confirmed: transfer basis}} and take steps to keep it protected to the standard the Data Protection Act 2012 requires.")],
    },
    {
      title: "How it is protected",
      blocks: [
        {
          ul: [
            "Encryption in transit",
            "Role-based access control with least privilege",
            "Two-step sign-in with an authenticator app for every account",
            "Audit logging of changes to rosters, staff and settings",
            "Account lockout and session timeout",
            "Access removed when a staff member is deactivated",
          ],
        },
      ],
    },
    {
      title: "If something goes wrong",
      blocks: [p("If a personal data breach occurs, we will tell the affected facility without undue delay and in any event within **48 hours** of becoming aware, with the facts needed for them to decide whether to notify the Data Protection Commission. We keep a breach register available to any affected facility on request.")],
    },
    {
      title: "Children",
      blocks: [p("HealthFlow is used by employed adults. We do not knowingly collect data about children.")],
    },
    {
      title: "Changes to this policy",
      blocks: [p("We will publish changes here with a new version number and date. For material changes we will tell facility administrators in advance.")],
    },
  ],
};

const t = (head: string[], rows: string[][]): Block => ({ table: { head, rows } });

export const DPA: LegalDoc = {
  title: "HealthFlow Data Processing Agreement",
  version: "1.0 (draft)",
  effective: "{{to be confirmed: effective date}}",
  intro: "Forms part of the HealthFlow Terms of Service.",
  sections: [
    {
      title: "Parties and roles",
      blocks: [
        p("**The Controller:** the facility named in its subscription, at the address given there."),
        p("**The Processor:** PS Tech, {{to be confirmed: registration details}}, of {{to be confirmed: registered address}}, Ghana."),
        p("The Controller determines the purposes and means of processing staff personal data. The Processor processes it only on the Controller's documented instructions. Both are bound by the Data Protection Act 2012 (Act 843) and each is responsible for its own registration with the Data Protection Commission."),
      ],
    },
    {
      title: "Subject matter, duration, nature and purpose",
      blocks: [
        p("**Subject matter:** personal data of the Controller's staff, processed through the HealthFlow application."),
        p("**Duration:** the term of the subscription, plus the export and deletion periods in clause 12."),
        p("**Nature and purpose:** duty rostering, labour-compliance checking, leave administration, attendance recording, duty swaps, workforce reporting and, where the Controller grants it, district oversight."),
      ],
    },
    {
      title: "Categories of data subject and personal data",
      blocks: [
        p("**Data subjects:** the Controller's employed and engaged staff, and its system users."),
        p("**Personal data:** name, staff number, telephone, email, address, emergency contact, photograph (where consented), cadre, department, position, employment type and status, date joined, duty assignments, attendance records, duty swaps, leave type and dates, and system access records."),
        p("**Special personal data:** leave records of a type that indicates health, such as sick leave and maternity leave, constitute data concerning health. **The application provides no field for a diagnosis, symptom, condition or medical note, and the Processor will not introduce one.**"),
      ],
    },
    {
      title: "The Controller's instructions and responsibilities",
      blocks: [
        p("The Controller instructs the Processor to process personal data as necessary to provide HealthFlow, and as further instructed in writing."),
        p("The Controller is responsible for: the lawfulness of its own processing and lawful basis; informing its staff through a privacy notice; its own registration with the Data Protection Commission; approving the retention schedule; deciding who receives access and removing it when staff leave; and deciding whether to grant district visibility and on what scope."),
      ],
    },
    {
      title: "The Processor's obligations",
      blocks: [p("The Processor shall: process only on documented instruction and tell the Controller if an instruction appears unlawful; ensure everyone with access is under a duty of confidentiality; implement the measures in clause 6; not engage a sub-processor except under clause 7; assist the Controller with data subject requests under clause 8; notify breaches under clause 9; make available the information needed to demonstrate compliance; and delete or return the data under clause 12.")],
    },
    {
      title: "Security measures",
      blocks: [
        p("The Processor shall maintain, as a minimum:"),
        {
          ul: [
            "Encryption of personal data in transit and at rest, including backups",
            "Role-based access control on the principle of least privilege, enforced server-side and not in the user interface alone",
            "Strict isolation between facilities, verified by automated testing, such that no facility can access another's data by any route",
            "Multi-factor authentication required for administrative and district accounts",
            "Audit logging of access and changes, readable by the Controller, including any access by the Processor's own support staff",
            "Automated backups with periodically tested restores",
            "Immediate revocation of access when a staff member is deactivated",
            "A documented incident response procedure with named roles",
            "Secure development practice, including vulnerability scanning of dependencies",
          ],
        },
      ],
    },
    {
      title: "Sub-processors",
      blocks: [p("The Controller authorises the sub-processors listed in Schedule 1. The Processor shall impose equivalent obligations on each, remains fully liable for their performance, and shall give the Controller at least **30 days' written notice** before adding or replacing one. The Controller may object on reasonable data-protection grounds, and if the matter cannot be resolved, may terminate without penalty.")],
    },
    {
      title: "Data subject requests",
      blocks: [
        p("The application allows each staff member to view and download their own complete record immediately, without needing to make a request."),
        p("For anything further, the Processor shall notify the Controller promptly of any request received directly, shall not respond to it itself except to confirm receipt and redirect, and shall assist the Controller in responding within these targets:"),
        t(["Request", "Target"], [["Access and portability", "Immediate, by self-service"], ["Correction", "14 days"], ["Objection", "14 days"], ["Erasure", "30 days"]]),
      ],
    },
    {
      title: "Breach notification",
      blocks: [
        p("The Processor shall notify the Controller **without undue delay and in any event within 48 hours** of becoming aware of a personal data breach affecting the Controller's data, providing: what happened and when, the categories and approximate number of data subjects and records, the likely consequences, the containment and remedial measures taken, and a contact point."),
        p("Notification to the Data Protection Commission and to affected data subjects is the Controller's decision. The Processor shall provide the written report needed to make it, and shall maintain a breach register available to the Controller on request."),
      ],
    },
    {
      title: "Audit",
      blocks: [p("The Processor shall make available the information necessary to demonstrate compliance, and shall permit the Controller, on reasonable notice and no more than once a year unless a breach has occurred, to audit compliance with this agreement.")],
    },
    {
      title: "Hosting and transfers",
      blocks: [
        p("The data is hosted by the services in Schedule 1, in {{to be confirmed: region}}. The Processor shall give the Controller written notice before any change of hosting region."),
        p("Where personal data is transferred outside Ghana, the Processor shall ensure protection equivalent to that required by the Data Protection Act 2012."),
      ],
    },
    {
      title: "Retention, return and deletion",
      blocks: [
        p("Retention follows the schedule approved by the Controller within the application. Records past retention are deleted only after the Controller confirms; the Processor shall not delete the Controller's data automatically."),
        p("On termination: the Controller may export all data for **30 days**. The Processor shall then delete it, including from backups on its ordinary backup cycle, within **90 days**, and confirm the deletion in writing."),
        p("The Processor shall not withhold data for any reason, including unpaid fees."),
      ],
    },
    {
      title: "Liability and law",
      blocks: [
        p("Liability under this agreement is subject to the limitations in the Terms of Service, except where the Act imposes liability that cannot be limited."),
        p("This agreement is governed by the laws of the Republic of Ghana."),
      ],
    },
    {
      title: "Schedule 1: sub-processors",
      blocks: [
        t(["Sub-processor", "Purpose", "Location", "Data accessed"], [
          ["Render", "Runs the HealthFlow server", "{{to be confirmed: region}}", "All application data"],
          ["Neon", "Holds the database", "{{to be confirmed: region}}", "All application data"],
          ["Resend", "Sends system email, when switched on", "{{to be confirmed: region}}", "Name, email, notification content"],
        ]),
      ],
    },
    {
      title: "Schedule 2: technical and organisational measures",
      blocks: [p("As set out in clause 6, and on the [Security page](/security), which forms part of this agreement.")],
    },
  ],
};

export const SECURITY: LegalDoc = {
  title: "Security",
  version: "1.0",
  effective: "5 October 2026",
  sections: [
    { title: "Read this before approving", blocks: [p("This page describes the technical and organisational measures HealthFlow applies to staff personal data, so a district health directorate can review them before approval.")] },
    { title: "Measures", blocks: [{ ul: [
      "**Encryption in transit and at rest.** All data is transmitted over TLS and encrypted at rest.",
      "**Role-based access and least privilege.** Every action is scoped to the caller's facility or district.",
      "**Multi-factor authentication for administrators.**",
      "**Immutable audit logging.** Every material change is recorded with the actor, date and reason.",
      "**Automated backups.** Recovery point objective of 24 hours; recovery time objective of 4 hours.",
    ] }] },
    { title: "Where the data is hosted", blocks: [p("Data is hosted on Google Cloud. Data for Ghanaian facilities is processed in the European region.")] },
    { title: "Sub-processors", blocks: [{ ul: ["Google Cloud: hosting", "Google Workspace: email"] }, p("No other sub-processor processes personal data.")] },
    { title: "Data Protection Commission registration", blocks: [p("Registration is pending. The registration number will be shown here once issued.")] },
    { title: "Breach notification commitment", blocks: [p("We notify affected facilities and the Data Protection Commission without undue delay, and no later than 72 hours after becoming aware of a personal data breach.")] },
    { title: "Report a vulnerability", blocks: [p("Email security@pstech.com.gh. This address is monitored.")] },
  ],
};
