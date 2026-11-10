import type { AttachedFile, PageContext } from "../shared/types";
import { codexCompleteRaw, listModels, selectModel } from "../agents/codexApi";

const MAX_PAGE_QUESTION_LENGTH = 2000;
const MAX_PAGE_TEXT_LENGTH = 12000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const PAGE_ASSISTANT_INSTRUCTIONS = `Tu es un assistant qui repond aux questions sur la page web actuellement ouverte.
Base tes reponses sur le contenu fourni ci-dessous et sur les fichiers joints si presents.
Si l'information n'est pas disponible, indique-le clairement.
Reponds en francais, de facon concise et utile.`;

function buildFilePart(file: AttachedFile) {
  if (file.mimeType.startsWith("image/")) {
    throw new Error(`Le modèle actuel ne prend pas les images en charge. Retire le fichier "${file.name}" ou change de modèle.`);
  }
  if (file.mimeType === "application/pdf") {
    return {
      type: "input_file",
      filename: file.name,
      file_data: file.dataUrl,
    };
  }
  if (file.mimeType === "text/plain" || file.mimeType === "text/markdown") {
    return {
      type: "input_file",
      filename: file.name,
      file_data: file.dataUrl,
    };
  }
  throw new Error(`Type de fichier non pris en charge : ${file.mimeType}`);
}

export async function answerPageQuestion(question: string, page: PageContext, files?: AttachedFile[]): Promise<string> {
  const normalizedQuestion = question.trim().slice(0, MAX_PAGE_QUESTION_LENGTH);
  if (!normalizedQuestion) throw new Error("Saisis une question avant de l'envoyer.");
  if (!page || typeof page.url !== "string" || typeof page.title !== "string" || typeof page.text !== "string") {
    throw new Error("Le contexte de la page est invalide.");
  }

  const validFiles = (files ?? []).filter((f) => f.size <= MAX_FILE_SIZE);
  const pageText = page.text.slice(0, MAX_PAGE_TEXT_LENGTH);
  const contextText = [
    `Question de l'utilisateur :\n${normalizedQuestion}`,
    "",
    "Contexte de la page :",
    JSON.stringify({ url: page.url, title: page.title, text: pageText }),
  ].join("\n");

  const content: unknown[] = [{ type: "input_text", text: contextText }];
  for (const f of validFiles) {
    content.push(buildFilePart(f));
  }

  const input = [{ role: "user", content }];
  return codexCompleteRaw(input, PAGE_ASSISTANT_INSTRUCTIONS);
}

export { listModels, selectModel };
