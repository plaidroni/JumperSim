export async function loadJumpFormation(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load formation");
  return await response.json();
}
