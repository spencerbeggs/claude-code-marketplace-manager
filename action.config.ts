import { defineConfig } from "@savvy-web/github-action-builder";

export default defineConfig({
	entries: {
		pre: "src/pre.ts",
		main: "src/main.ts",
		post: "src/post.ts",
	},
	build: {
		minify: true,
	},
	persistLocal: {
		enabled: false,
		path: ".github/actions/local",
	},
});
