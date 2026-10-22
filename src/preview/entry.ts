import { installPreviewTransport } from './transport';
installPreviewTransport();
// Delay all application module evaluation until the sandbox is in place.
void import('../main');
