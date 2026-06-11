const fixtureOutputPath = "fixtures/news-character/news-character-fake-preview.mp4";
const publicBase = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export const sampleOutputUrl = `${publicBase}${fixtureOutputPath}`;
