/** External Containers SDK boundary: record the env passed to process start. */
export class Container {
  envVars: Record<string, string> = {};
  readonly starts: Record<string, string>[] = [];
  start(): Promise<void> {
    this.starts.push({ ...this.envVars });
    return Promise.resolve();
  }
  startAndWaitForPorts(): Promise<void> {
    this.starts.push({ ...this.envVars });
    return Promise.resolve();
  }
}

export { Container as ContainerProxy };
