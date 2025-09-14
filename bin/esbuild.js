/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check
const esbuild = require('esbuild');

/**
 * @typedef {import('esbuild').BuildOptions} BuildOptions
 */

/** @type {BuildOptions} */
const sharedWebOptions = {
	bundle: true,
	external: ['vscode'],
	target: 'es2020',
	platform: 'browser',
	alias: {
   // FIXME: wasm-wasi-lsp also needs separate node/web builds to pick the correct impl.
	  'vscode-languageclient': 'vscode-languageclient/browser',
	},
	sourcemap: true,
};

/** @type {BuildOptions} */
const webOptions = {
	entryPoints: ['extension.ts'],
	outfile: 'dist/web/extension.js',
	format: 'cjs',
	...sharedWebOptions,
};

/** @type {BuildOptions} */
const sharedDesktopOptions = {
	bundle: true,
	external: ['vscode'],
	target: 'es2020',
	platform: 'node',
	alias: {
	  'vscode-languageclient': 'vscode-languageclient/node',
	},
	sourcemap: true,
};

/** @type {BuildOptions} */
const desktopOptions = {
	entryPoints: ['extension.ts'],
	outfile: 'dist/desktop/extension.js',
	format: 'cjs',
	...sharedDesktopOptions,
};

function createContexts() {
	return Promise.all([
		esbuild.context(webOptions),
		esbuild.context(desktopOptions),
	]);
}

createContexts().then(contexts => {
	if (process.argv[2] === '--watch') {
		const promises = [];
		for (const context of contexts) {
			promises.push(context.watch());
		}
		return Promise.all(promises).then(() => { return undefined; });
	} else {
		const promises = [];
		for (const context of contexts) {
			promises.push(context.rebuild());
		}
		Promise.all(promises).then(async () => {
			for (const context of contexts) {
				await context.dispose();
			}
		}).then(() => { return undefined; }).catch(console.error);
	}
}).catch(console.error);
