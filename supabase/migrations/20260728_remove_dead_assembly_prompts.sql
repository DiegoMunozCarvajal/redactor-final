-- Remove orphaned assembly prompts from "James Clear - 5.20" template.
-- These isAssembly=true rows in the prompts table are never read by the
-- generation pipeline — assembly is resolved from the prompt registry
-- (prompt_definitions -> prompt_revisions -> prompt_defaults).
-- They get copied to projects via copy-template-prompts.ts but serve no
-- purpose other than being excluded from content fragment generation.
-- Deleting them is safe: no code reads template assembly prompts for
-- assembly, and the content filter (!isAssembly && !isCritique && !isCorrector)
-- simply won't encounter them.

DELETE FROM prompts
WHERE book_template_id = '3c582c95-08cb-4f1e-86d6-e9f2b1fd46c8'
  AND is_assembly = true;
