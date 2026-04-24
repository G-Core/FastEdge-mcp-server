import { availableFastEdgeTemplates } from "./index.js";

type ScaffoldTemplateType = (typeof availableFastEdgeTemplates)[number];

type Language = "javascript" | "typescript" | "assemblyscript" | "rust";

interface ScaffoldData {
  description: string;
  language: Language;
  applicationType: "http" | "cdn";
  files: Record<string, string>;
}

type FastEdgeTemplates = Record<ScaffoldTemplateType, Array<ScaffoldData>>;

export { FastEdgeTemplates, Language, ScaffoldData, ScaffoldTemplateType };
