import { NodeServer } from '@bitdev/node.node-server';

export default NodeServer.from({
  name: 'trader-service',
  mainPath: import.meta.resolve('./trader-service.app-root.js'),
});
