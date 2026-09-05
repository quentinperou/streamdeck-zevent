import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

const isProd = process.env.NODE_ENV === "production";
const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "fr.quentinperou.zevent.sdPlugin";

/** @type {import("rollup").RollupOptions} */
export default {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "cjs",
		sourcemap: isWatching,
		plugins: isProd ? [terser()] : [],
	},
	plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()],
	external: ["bufferutil", "utf-8-validate"],
};
