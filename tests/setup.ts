// The sim's modules expect a browser-like global; give them one for Node tests.
(globalThis as any).window = globalThis;
(globalThis as any).devConsoleVars = { planeSpeed: 90 };
