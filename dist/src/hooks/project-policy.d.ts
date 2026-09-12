export declare function extractProjectHint(text: string): string;
export declare function machineProjectName(env?: NodeJS.ProcessEnv): string;
export declare function resolveProjectBinding(cwd?: string, env?: NodeJS.ProcessEnv, prompt?: string, selected?: string): ProjectBinding;
export interface ProjectBinding {
    name: string;
    source: string;
}
export declare function localPortableBinding(cwd: string, env?: NodeJS.ProcessEnv): ProjectBinding | undefined;
export declare function normalizeRemote(remote: string): string;
//# sourceMappingURL=project-policy.d.ts.map