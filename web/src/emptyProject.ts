// Seed content for a brand-new empty project: a single `main` system, so the
// auto-seeded `views/main.hcl` view (and the component-creation flow)
// always have a system to link to instead of an empty file.
export const EMPTY_PROJECT_HCL = `system "main" {
  full_name = "Main system"
}
`;
