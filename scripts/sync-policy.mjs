// Unpublished catalog entries have no inferred GitHub repository or release.
export async function syncPublishedProjects(projects, sync) {
  return Promise.all(projects.filter(project => project.pending !== true).map(sync));
}
