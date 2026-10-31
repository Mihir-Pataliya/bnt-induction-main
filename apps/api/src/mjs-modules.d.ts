declare module "*.mjs" {
  export function validateBasicProfile(
    input: object,
    options?: { requiresDriverLicence?: boolean; today?: string }
  ): Record<string, string>;
}
