import themeTokens from "./scripts/lib/theme-tokens-postcss.cjs";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

export default {
  plugins: [themeTokens(), tailwindcss(), autoprefixer()],
};
