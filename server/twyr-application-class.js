/* eslint-disable security/detect-object-injection */

'use strict';

/**
 * Module dependencies, required for ALL Twyr' modules
 * @ignore
 */

/**
 * Module dependencies, required for this module
 * @ignore
 */
const upash = require('upash');
upash.install('pbkdf2', require('@phc/pbkdf2'));

const TwyrBaseModule = require('twyr-base-module').TwyrBaseModule;
const TwyrBaseError = require('twyr-base-error').TwyrBaseError;

/**
 * @class   TwyrApplication
 * @extends {TwyrBaseModule}
 *
 * @param   {TwyrBaseModule} [parent] - The parent module, if any. In this case, it's always null
 * @param   {TwyrModuleLoader} [loader] - The loader to be used for managing modules' lifecycle, if any.
 *
 * @classdesc The Twyr Server Application Class.
 *
 * @description
 * The Application Class for this server.
 *
 * This class has two major functionalities:
 * 1. Provide an environment for the rest of the server modules to reside in
 * +  Load / Unload the server modules and control the Startup / Shutdown sequences
 */
class TwyrApplication extends TwyrBaseModule {
	// #region Constructor
	constructor(application, parent, loader) {
		super(parent, loader);

		this.$application = application;
		this.$uuid = require('uuid/v4')();
	}
	// #endregion

	// #region Startup / Shutdown
	/**
	 * @function
	 * @instance
	 * @memberof TwyrApplication
	 * @name     bootupServer
	 *
	 * @returns  {Array} - The aggregated status returned by sub-modules (if any).
	 *
	 * @summary  Loads / Initializes / Starts-up sub-modules.
	 */
	async bootupServer() {
		if(twyrEnv === 'development' || twyrEnv === 'test') console.log(`${this.name}::bootupServer`);

		const allStatuses = [];
		let bootupError = null;

		try {
			const osLocale = require('os-locale');
			const serverLocale = await osLocale();

			Object.defineProperties(this, {
				'$locale': {
					'value': serverLocale
				}
			});

			let lifecycleStatuses = null;

			this.emit('server-loading');
			lifecycleStatuses = await this.load();
			allStatuses.push(`${process.title} load status: ${lifecycleStatuses ? JSON.stringify(lifecycleStatuses, null, 2) : true}\n`);
			this.emit('server-loaded');

			this.emit('server-initializing');
			lifecycleStatuses = await this.initialize();
			allStatuses.push(`${process.title} initialize status: ${lifecycleStatuses ? JSON.stringify(lifecycleStatuses, null, 2) : true}\n`);
			this.emit('server-initialized');

			this.emit('server-starting');
			lifecycleStatuses = await this.start();
			allStatuses.push(`${process.title} start status: ${lifecycleStatuses ? JSON.stringify(lifecycleStatuses, null, 2) : true}\n`);
			this.emit('server-started');

			await this._setupWebserverRoutes();
			this.emit('server-online');
		}
		catch(err) {
			bootupError = (err instanceof TwyrBaseError) ? err : new TwyrBaseError(`Bootup Error`, err);
			allStatuses.push(`Bootup error: ${bootupError.toString()}`);
		}

		if(!bootupError && ((twyrEnv === 'development') || (twyrEnv === 'test')))
			console.info(`\n\n${allStatuses.join('\n')}\n\n`);

		if(bootupError) {
			console.error(`\n\n${allStatuses.join('\n')}\n\n`);
			throw bootupError;
		}

		return null;
	}

	/**
	 * @function
	 * @instance
	 * @memberof TwyrApplication
	 * @name     shutdownServer
	 *
	 * @returns  {Array} - The aggregated status returned by sub-modules (if any).
	 *
	 * @summary  Shuts-down / Un-initializes / Un-loads sub-modules.
	 */
	async shutdownServer() {
		if(twyrEnv === 'development' || twyrEnv === 'test') console.log(`${this.name}::shutdownServer`);

		const allStatuses = [];
		let shutdownError = null;

		try {
			this.emit('server-offline');
			let lifecycleStatuses = null;

			this.emit('server-stopping');
			lifecycleStatuses = await this.stop();
			allStatuses.push(`${process.title} stop status: ${lifecycleStatuses ? JSON.stringify(lifecycleStatuses, null, 2) : true}\n`);
			this.emit('server-stopped');

			this.emit('server-uninitializing');
			lifecycleStatuses = await this.uninitialize();
			allStatuses.push(`${process.title} uninitialize status: ${lifecycleStatuses ? JSON.stringify(lifecycleStatuses, null, 2) : true}\n`);
			this.emit('server-uninitialized');

			this.emit('server-unloading');
			lifecycleStatuses = await this.unload();
			allStatuses.push(`${process.title} unload status: ${lifecycleStatuses ? JSON.stringify(lifecycleStatuses, null, 2) : true}\n`);
			this.emit('server-unloaded');
		}
		catch(err) {
			shutdownError = (err instanceof TwyrBaseError) ? err : new TwyrBaseError(`Shutdown Error`, err);
			allStatuses.push(`Shutdown error: ${shutdownError.toString()}`);
		}

		if(!shutdownError && ((twyrEnv === 'development') || (twyrEnv === 'test')))
			console.info(`\n\n${allStatuses.join('\n')}\n\n`);

		if(shutdownError) {
			console.error(`\n\n${allStatuses.join('\n')}\n\n`);
			throw shutdownError;
		}

		return null;
	}
	// #endregion

	// #region Re-configuration
	async _subModuleReconfigure(subModule) {
		await super._subModuleReconfigure(subModule);
		if(subModule.name !== 'WebserverService') return;

		await this._setupWebserverRoutes();
	}
	// #endregion

	// #region Private Methods
	async _setupWebserverRoutes() {
		const inflection = require('inflection');
		const appRouter = this.$services.WebserverService.Interface.Router;

		// Add in the components
		Object.keys(this.$components || {}).forEach((componentName) => {
			const componentRouter = this.$components[componentName].Router;
			const inflectedComponentName = inflection.transform(componentName, ['foreign_key', 'dasherize']).replace('-id', '');

			appRouter.use(`/${inflectedComponentName}`, componentRouter.routes(), componentRouter.allowedMethods());
		});

		// Add in the features
		Object.keys(this.$features || {}).forEach((featureName) => {
			const featureRouter = this.$features[featureName].Router;
			const inflectedFeatureName = inflection.transform(featureName, ['foreign_key', 'dasherize']).replace('-id', '');

			appRouter.use(`/${inflectedFeatureName}`, featureRouter.routes(), featureRouter.allowedMethods());
		});

		// Add in the templates at the end...
		Object.keys(this.$templates).forEach((tmplName) => {
			const tmplRouter = this.$templates[tmplName].Router;
			appRouter.get('*', tmplRouter.routes(), tmplRouter.allowedMethods());
		});

		// Browser Error Data via the Beacon API / XHR Post
		appRouter.post('/collectClientErrorData', (ctxt) => {
			const beaconData = ctxt.request.body;
			// TODO: Do something more sophisticated - like storing it into Cassandra, and running analysis
			console.error(`Client Error Data: ${JSON.stringify(beaconData, null, '\t')}`);
		});

		return;
	}
	// #endregion

	// #region Properties
	/**
	 * @member   {string} name
	 * @instance
	 * @override
	 * @memberof TwyrApplication
	 *
	 * @readonly
	 */
	get name() {
		return this.$application || this.constructor.name;
	}

	/**
	 * @override
	 */
	get basePath() {
		return __dirname;
	}
	// #endregion
}

exports.TwyrApplication = TwyrApplication;
