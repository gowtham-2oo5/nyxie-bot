const DDG_URL = "https://api.duckduckgo.com/";

export const search = async (query: string): Promise<string | null> => {
  try {
    const params = new URLSearchParams({ q: query, format: "json", no_html: "1", skip_disambig: "1" });
    const res = await fetch(`${DDG_URL}?${params}`);
    if (!res.ok) return null;

    const data = await res.json() as any;

    // Try abstract (Wikipedia-style summary)
    if (data.Abstract) return data.Abstract;

    // Try answer (instant answer)
    if (data.Answer) return data.Answer;

    // Try first related topic
    if (data.RelatedTopics?.length && data.RelatedTopics[0]?.Text) {
      return data.RelatedTopics[0].Text;
    }

    return null;
  } catch {
    return null;
  }
};
