import { Platform } from '@bitdev/platforms.platform';

const TraderService = import.meta.resolve('@h232/alpaca-trader.trader-service');
const TraderDashboard = import.meta.resolve('@h232/alpaca-trader.trader-dashboard');
const PlatformGateway = import.meta.resolve('@bitdev/platforms.backend.gateway-server');

/**
 * AlpacaTrader — composable platform that runs the Alpaca paper-trading bot
 * backend (trader-service) behind a gateway and serves the React dashboard
 * (trader-dashboard) as the frontend. Run with `bit run alpaca-trader`.
 */
export const AlpacaTrader = Platform.from({
  name: 'alpaca-trader',

  frontends: {
    main: TraderDashboard,
    mainPortRange: [3000, 3100],
  },

  backends: {
    // default gateway — proxies REST requests to the trader-service under /api/trader.
    main: PlatformGateway,
    services: [
      TraderService,
    ],
  },
});

export default AlpacaTrader;
