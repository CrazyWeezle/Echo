import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.echo.echo',
  appName: 'ECHO',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // Allow navigating to your hosted domain if you choose to use live API/static
    allowNavigation: ['app.echologin.org'],
  },
};

export default config;
