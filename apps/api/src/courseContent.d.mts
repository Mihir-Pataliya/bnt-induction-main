export function normalizeCourseContentItems(slide: Record<string, any>): Array<{
  id: string;
  type: "text" | "video" | "image" | "pdf" | "audio";
  title: string;
  text?: string;
  url?: string;
  caption?: string;
  requireRead?: boolean;
}>;
