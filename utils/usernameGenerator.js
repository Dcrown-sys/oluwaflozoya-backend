function cleanName(value = "") {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function generateEngineerUsername(fullName = "") {
  const base = cleanName(fullName) || "ENGINEER";
  const randomNumber = Math.floor(1000 + Math.random() * 9000);

  return `ZOYA-${base}${randomNumber}`;
}

export default {
  generateEngineerUsername,
};