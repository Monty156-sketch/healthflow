"use client";

import { GiveFeedback } from "@/components/Feedback";
import { PageHeader, Panel } from "@/components/ui";

export default function FeedbackPage() {
  return (
    <>
      <PageHeader title="Feedback" description="Tell us what would make HealthFlow easier for you." />
      <div className="max-w-2xl">
        <Panel title="What do you need from us?" description="An idea, something that is not working well, or something you like. Everyone's feedback goes straight to the HealthFlow team and we act on it. Please do not write patient names or details.">
          <GiveFeedback />
        </Panel>
      </div>
    </>
  );
}
