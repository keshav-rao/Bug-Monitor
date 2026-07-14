(function () {
  'use strict';

  if (typeof sap === 'undefined' || !sap.ui) return;

  const CONFIG = {
    enabled: true,
    captureModelChanges: true,
    captureControllerCalls: true,
  };

  function getConnector() {
    return window.__BugMonitorSAP || null;
  }

  function postEvent(event) {
    const conn = getConnector();
    if (conn) conn.postEvent(event);
  }

  function hookViewLifecycle() {
    try {
      sap.ui.getCore().attachEvent('beforeViewInit', function (oEvent) {
        if (!CONFIG.enabled) return;
        const view = oEvent.getParameter('view');
        if (!view) return;
        postEvent({
          type: 'sap_fiori',
          subtype: 'view_init',
          viewName: view.getViewName ? view.getViewName() : 'unknown',
          viewId: view.getId ? view.getId() : null,
        });
      });
    } catch (e) {}
  }

  function hookNavigation() {
    try {
      const Router = sap.ui.core.routing.Router;
      if (!Router) return;
      const origNavTo = Router.prototype.navTo;
      Router.prototype.navTo = function (name, parameters, ...rest) {
        if (CONFIG.enabled) {
          postEvent({
            type: 'sap_fiori',
            subtype: 'navigation',
            routeName: name,
            parameters: parameters ? JSON.stringify(parameters).slice(0, 500) : null,
          });
        }
        return origNavTo.call(this, name, parameters, ...rest);
      };
    } catch (e) {}
  }

  function hookModelChanges() {
    if (!CONFIG.captureModelChanges) return;
    try {
      sap.ui.getCore().attachModelContextChange(function (oEvent) {
        if (!CONFIG.enabled) return;
        const model = oEvent.getParameter('model');
        if (!model) return;
        postEvent({
          type: 'sap_fiori',
          subtype: 'model_change',
          modelName: model.getName ? model.getName() : 'unnamed',
        });
      });
    } catch (e) {}
  }

  function hookController() {
    if (!CONFIG.captureControllerCalls) return;
    try {
      const Controller = sap.ui.core.mvc.Controller;
      if (!Controller) return;
      const origOnInit = Controller.prototype.onInit;
      Controller.prototype.onInit = function () {
        postEvent({
          type: 'sap_fiori',
          subtype: 'controller_onInit',
          controllerName: this.getView ? this.getView().getViewName() : 'unknown',
        });
        return origOnInit ? origOnInit.apply(this, arguments) : undefined;
      };
    } catch (e) {}
  }

  sap.ui.getCore().attachInit(function () {
    if (!CONFIG.enabled) return;
    hookViewLifecycle();
    hookNavigation();
    hookModelChanges();
    hookController();
    postEvent({ type: 'sap_fiori', subtype: 'monitor_ready' });
  });
})();
