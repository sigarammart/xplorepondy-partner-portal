import { createFileRoute } from "@tanstack/react-router";
import { ExperienceEditor } from "@/components/experience-editor";

export const Route = createFileRoute("/submit-experiences")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  component: SubmitExperiencesPage,
});

function SubmitExperiencesPage() {
  const { edit } = Route.useSearch();
  const experienceId = edit && /^\d+$/.test(edit) && Number(edit) > 0 ? Number(edit) : undefined;

  return experienceId
    ? <ExperienceEditor mode="edit" experienceId={experienceId} />
    : <ExperienceEditor mode="create" />;
}
