// Shared by the page and server so both explain the same requirements.
export function analysisReadiness(settings) {
  const missing = [];
  const search = settings.searchReady ?? settings.configured?.TAVILY_API_KEY;
  if (!search) missing.push('Set up a web search service in Settings.');
  const ai = settings.aiReady ?? (settings.provider === 'local' ? !!settings.localModel?.trim() : !!settings.configured?.ANTHROPIC_API_KEY);
  if (!ai) missing.push(settings.provider === 'none' ? 'The dossier needs an AI: choose one in Settings.' : settings.provider === 'local' ? 'Enter the local model name in Settings.' : settings.provider === 'compat' ? 'Save the key of the compatible AI service (e.g. DeepSeek) in Settings.' : 'Save the Anthropic key, or choose another AI service or a local model in Settings.');
  return {ready: missing.length === 0, missing, message: missing.length ? missing.join(' ') : 'Setup complete. Start the analysis whenever you like; connections will be used during the search.'};
}
