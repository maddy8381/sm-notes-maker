import { z } from "zod";

import { docJsonStringSchema } from "@/lib/editor/content";
import { CODE_LANGUAGES } from "@/lib/editor/schema";

/** Shared between the action wrappers and the forms that call them. */

export const idSchema = z.string().min(1).max(40);

export const technologyNameSchema = z
  .string()
  .trim()
  .min(1, "Give it a name")
  .max(60, "Keep the name under 60 characters");

export const createTechnologySchema = z.object({
  name: technologyNameSchema,
  description: z.string().trim().max(200, "Keep it under 200 characters").optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(32).optional(),
});

export const updateTechnologySchema = z.object({
  id: idSchema,
  name: technologyNameSchema.optional(),
  description: z.string().trim().max(200).nullish(),
  icon: z.string().max(40).nullish(),
  color: z.string().max(32).nullish(),
});

export const pageTitleSchema = z
  .string()
  .trim()
  .min(1, "Give it a title")
  .max(200, "Keep the title under 200 characters");

export const createPageSchema = z.object({
  technologyId: idSchema,
  title: pageTitleSchema,
  template: z.string().max(40).optional(),
});

/**
 * The autosave payload.
 *
 * `expectedRevision` is what makes concurrent edits safe — see
 * savePageContent in src/server/pages.ts. It is required rather than optional
 * so a client cannot opt out of the check by omitting it.
 */
export const savePageSchema = z.object({
  id: idSchema,
  title: pageTitleSchema.optional(),
  // A JSON string rather than the object itself — see docJsonStringSchema for
  // why passing the nested structure through a Server Action loses attributes.
  content: docJsonStringSchema.optional(),
  expectedRevision: z.number().int().min(0),
});

export const reorderSchema = z.object({
  id: idSchema,
  /** Index within the list as currently displayed. */
  toIndex: z.number().int().min(0),
});

export const setTagsSchema = z.object({
  pageId: idSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
});

export const searchSchema = z.object({
  query: z.string().trim().max(200),
  technologyId: idSchema.optional(),
  tagSlugs: z.array(z.string().max(60)).max(10).optional(),
  cursor: z.number().int().min(0).optional(),
});

export const codeLanguageSchema = z.enum(CODE_LANGUAGES);

export const favoriteSchema = z.object({
  id: idSchema,
  isFavorite: z.boolean(),
});

export const movePageSchema = z.object({
  id: idSchema,
  technologyId: idSchema,
});
