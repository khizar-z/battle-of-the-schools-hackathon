import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const siteRecipeSchema = z.object({
  domain: z.string().min(1),
  searchUrlTemplate: z.string().url().optional(),
  searchSteps: z.array(z.object({ action: z.string().min(1), target: z.string().min(1) })),
  resultSelector: z.string().min(1).optional(),
  fieldSelectors: z
    .object({
      title: z.string().min(1).optional(),
      price: z.string().min(1).optional(),
      image: z.string().min(1).optional(),
      location: z.string().min(1).optional(),
      url: z.string().min(1).optional()
    })
    .optional(),
  learnedAt: z.string().datetime()
});

export type SiteRecipe = z.infer<typeof siteRecipeSchema>;

export interface RecipeStore {
  get(domain: string): Promise<SiteRecipe | undefined>;
  save(recipe: SiteRecipe): Promise<void>;
}

export class InMemoryRecipeStore implements RecipeStore {
  private readonly recipes = new Map<string, SiteRecipe>();

  async get(domain: string): Promise<SiteRecipe | undefined> {
    return this.recipes.get(normalizeDomain(domain));
  }

  async save(recipe: SiteRecipe): Promise<void> {
    this.recipes.set(normalizeDomain(recipe.domain), siteRecipeSchema.parse(recipe));
  }
}

export class FileRecipeStore implements RecipeStore {
  private readonly recipes = new Map<string, SiteRecipe>();
  private loaded = false;

  constructor(private readonly filePath = resolve(process.cwd(), "data/site-recipes.json")) {}

  async get(domain: string): Promise<SiteRecipe | undefined> {
    await this.load();
    return this.recipes.get(normalizeDomain(domain));
  }

  async save(recipe: SiteRecipe): Promise<void> {
    await this.load();
    const parsed = siteRecipeSchema.parse(recipe);
    this.recipes.set(normalizeDomain(parsed.domain), parsed);
    await mkdir(dirname(this.filePath), { recursive: true });
    const serialized = JSON.stringify([...this.recipes.values()], null, 2);
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, this.filePath);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const content = await readFile(this.filePath, "utf8");
      const recipes = z.array(siteRecipeSchema).parse(JSON.parse(content));
      for (const recipe of recipes) this.recipes.set(normalizeDomain(recipe.domain), recipe);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function createRecipeStore(): RecipeStore {
  return new FileRecipeStore(process.env.RECIPE_STORE_PATH || undefined);
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
}

