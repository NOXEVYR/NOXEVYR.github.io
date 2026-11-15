// Pending and explicitly manual releases must not infer a source repository.
export async function syncPublishedProjects(projects, sync) {
  return Promise.all(projects.filter(project => project.pending !== true && project.releaseSync !== 'manual').map(sync));
}
