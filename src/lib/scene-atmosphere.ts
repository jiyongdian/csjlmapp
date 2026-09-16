const ATMOSPHERE_LABEL = "(?:\\u6c1b\\u56f4|\\u6c14\\u6c1b|\\u57fa\\u8c03)";
const INLINE_SCENE_ATMOSPHERE_RE = new RegExp(`^(.*?)(?:[\\uff0c,\\u3002\\uff1b;\\u3001\\s]*)${ATMOSPHERE_LABEL}[\\uff1a:]\\s*(.+)$`);
const STANDALONE_SCENE_ATMOSPHERE_RE = new RegExp(`^${ATMOSPHERE_LABEL}[\\uff1a:]\\s*(.+)$`);

type SceneAtmosphereInput = {
  description?: string | null;
  atmosphere?: string | null;
};

export const cleanSceneAtmosphere = (value: string | null | undefined) =>
  (value || "").trim().replace(/[\u3002\uff1b;\uff0c,\u3001.]+$/, "");

export const getStandaloneSceneAtmosphere = (line: string | null | undefined) => {
  const match = (line || "").trim().match(STANDALONE_SCENE_ATMOSPHERE_RE);
  return match ? cleanSceneAtmosphere(match[1]) : "";
};

export const splitSceneDescriptionAtmosphere = (
  description: string | null | undefined = "",
  atmosphere: string | null | undefined = "",
) => {
  const sourceDescription = description || "";
  const inlineAtmosphere = sourceDescription.match(INLINE_SCENE_ATMOSPHERE_RE);
  if (!inlineAtmosphere) {
    return {
      description: sourceDescription,
      atmosphere: cleanSceneAtmosphere(atmosphere),
    };
  }

  return {
    description: inlineAtmosphere[1].trim(),
    atmosphere: cleanSceneAtmosphere(atmosphere) || cleanSceneAtmosphere(inlineAtmosphere[2]),
  };
};

export function normalizeSceneAtmosphereInput<T extends SceneAtmosphereInput>(data: T): T {
  const hasDescription = Object.prototype.hasOwnProperty.call(data, "description");
  const hasAtmosphere = Object.prototype.hasOwnProperty.call(data, "atmosphere");
  if (!hasDescription && !hasAtmosphere) return data;

  const sceneParts = splitSceneDescriptionAtmosphere(
    hasDescription ? data.description : "",
    hasAtmosphere ? data.atmosphere : "",
  );
  const normalized: SceneAtmosphereInput = { ...data };
  if (hasDescription) normalized.description = sceneParts.description || null;
  if (hasAtmosphere || sceneParts.atmosphere) normalized.atmosphere = sceneParts.atmosphere || null;
  return normalized as T;
}
