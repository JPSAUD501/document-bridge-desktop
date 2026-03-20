declare module "playwright-core/lib/server/registry/index" {
  export interface RegistryExecutable {
    name: string;
    executablePath: (sdkLanguage: string) => string | undefined;
    executablePathOrDie: (sdkLanguage: string) => string;
  }

  export interface Registry {
    findExecutable: (name: string) => RegistryExecutable;
    resolveBrowsers: (
      aliases: string[],
      options: { shell?: "all" | "no" | "only" },
    ) => RegistryExecutable[];
    install: (executables: RegistryExecutable[], options?: { force?: boolean }) => Promise<void>;
  }

  export const registry: Registry;
}
