import { createFileRoute } from "@tanstack/react-router";
import { ExperienceEditor } from "@/components/experience-editor";

export const Route = createFileRoute("/my-experiences/$experienceId/edit")({ component: EditExperiencePage });

function EditExperiencePage() {
  const { experienceId } = Route.useParams();
  return <ExperienceEditor mode="edit" experienceId={Number(experienceId)} />;
}
