import Webcom from 'webcom/webcom';
import * as DataSync from './util/DataSync';
import cache from './util/cache';
import * as Log from './util/Log';
import Room from './Room';
import Device from './Device';
import { CONNECTED, NOT_CONNECTED } from './util/constants';

let initializing = false;

/**
 * User informations
 * @public
 */
export default class User {
  /**
   * Create a user
   * @param {Webcom/api.DataSnapshot|object} snapData The data snapshot
   * @access protected
   */
  constructor(snapData, userId) {
    const values = Object.assign({}, snapData.val());
    /**
     * User's unique id
     * @type {string}
     */
    // this.uid = snapData.name();
    this.uid = userId;
    /**
     * User's display name
     * @type {string}
     */
    this.name = values.name;
    /**
     * User's status
     * @type {string}
     */
    this.status = values.status;
    /**
     * User's last know connection ts
     * @type {number}
     */
    this.lastSeen = values.lastSeen;
    /**
     * Indicates if the user is an anonymous user
     * @type {boolean}
     */
    this.anonymous = /^anonymous/.test(values.provider);
    // TODO #Feat: Add 'extra' property for unrestricted additional information ?
  }

  /**
   * Invite a user directly. This will create a new Room, log you in it & invite the user.
   * @param {string} [message] a message to add to the invite
   * @return {Promise<{room: Room, invite: Invite}, Error>}
   */
  invite(message) {
    if (!cache.user) {
      return Promise.reject(new Error('Only an authenticated user can invite another User.'));
    }
    return Room.create(`${cache.user.uid}-${this.uid}`)
      .then(room => room.invite([this], null, message))
      .then(data => ({ room: data.room, invite: data.invites[0] }))
      .catch(Log.r('User~invite'));
  }

  /**
   * List Users's devices. Only for current user.
   * @access protected
   * @return {Promise<Device[], Error>}
   */
  devices() {
    return DataSync.list(`_/devices/${this.uid}`, Device);
  }

  /**
   * Init the current user
   * @access protected
   * @param {json} auth The user's identity (webcom JSON structure)
   * @param {string} [name] The user's display name
   * @returns {Promise<User, Error>}
   */
  static init(auth, name) {
    const id1 = Math.floor(Math.random() * 1000);
    const id2 = Math.floor(Math.random() * 1000);
    const uid = `${id1}/${id2}/${auth.uid}`;
    const userUid = `${id1}:${id2}:${auth.uid}`;
    // const uid = auth.uid;
    if (!initializing) {
      initializing = true;
      const d = { status: CONNECTED, lastSeen: DataSync.ts(), provider: auth.provider };
      if (name) {
        Object.assign(d, { name });
      }
      let deviceId = Webcom.INTERNAL.PersistentStorage.get(uid);
      return DataSync.update(`users/${uid}`, d)
      // Register current device
        .then(() => {
          const deviceMetadata = {
            status: CONNECTED,
            sdk: {
              reach: SDK_VERSION, // eslint-disable-line no-undef
              webcom: Webcom.SDK_VERSION
            },
            userAgent: navigator.userAgent
          };
          cache.userAgent = deviceMetadata.userAgent;
          if (deviceId) {
            return DataSync.update(`_/devices/${uid}/${deviceId}`, deviceMetadata);
          }
          return DataSync.push(`_/devices/${uid}`, deviceMetadata);
        })
        // Save device
        .then((deviceRef) => {
          if (!deviceId) {
            deviceId = deviceRef.name();
            Webcom.INTERNAL.PersistentStorage.set(uid, deviceId);
          }
          cache.device = deviceId;
        })
        // Add onDisconnect actions
        .then(() => {
          // Disconnect device
          DataSync.onDisconnect(`_/devices/${uid}/${deviceId}/status`).set(NOT_CONNECTED);
          // Update user status
          DataSync.onDisconnect(`users/${uid}`).update({
            status: NOT_CONNECTED,
            lastSeen: DataSync.ts()
          });
        })
        // Get user
        // .then(() => User.get(uid))
        .then(() => User.get(userUid))
        .then((user) => {
          initializing = false;
          return user;
        })
        .catch((e) => {
          Log.e(e);
          initializing = false;
          return Promise.reject(e);
        });
    }
    // return User.get(uid);
    return User.get(userUid);
  }

  /**
   * Disconnect the current user
   * @access protected
   * @param {User} user The current user
   * @returns {Promise}
   */
  static disconnect(user) {
    // Cancel onDisconnect
    // due to the problem of long list, uids have a : instead of /
    const userUid = user.uid.replace(/:/g, '/');
    // DataSync.onDisconnect(`_/devices/${user.uid}/${cache.device}/status`).cancel();
    // DataSync.onDisconnect(`users/${user.uid}`).cancel();
    DataSync.onDisconnect(`_/devices/${userUid}/${cache.device}/status`).cancel();
    DataSync.onDisconnect(`users/${userUid}`).cancel();
    if (user.anonymous) {
      return DataSync.remove(`_/devices/${userUid}`)
        .then(() => DataSync.get(`_/invites/${userUid}`))
        .then((invites) => {
          const inviteIds = [];
          invites.forEach((invite) => {
            inviteIds.push(invite.name());
          });
          return Promise.all(inviteIds.map(inviteId => DataSync.remove(`_/invites/${userUid}/${inviteId}`)));
        })
        // TODO refactor data model for invites so we can delete _/invites/${user.uid}
        // .then(() => DataSync.remove(`_/invites/${user.uid}`))
        .then(() => DataSync.remove(`users/${userUid}`))
        .then(() => {
          Webcom.INTERNAL.PersistentStorage.remove(userUid);
        })
        .catch(Log.r('User#anonymous_disconnect'));
    }
    return DataSync.set(`_/devices/${userUid}/${cache.device}/status`, NOT_CONNECTED)
      .then(() => DataSync.get(`_/devices/${userUid}`))
      .then((devices) => {
        // Only change user's status if no other device connected
        const hasConnectedDevices = devices.forEach(device => (
          new RegExp(`^${CONNECTED}$`)
        ).test(device.val().status));

        if (!hasConnectedDevices) {
          return DataSync.update(`users/${userUid}`, { status: NOT_CONNECTED });
        }
        return true;
      })
      .catch(Log.r('User#disconnect'));
  }

  /**
   * Get a user by its uid
   * @access private
   * @param {string} uid The user's uid
   * @returns {Promise<User, Error>}
   */
  static get(uid) {
    // due to the problem of long list, uids have a : instead of /
    const userUid = uid.replace(/:/g, '/');
    return DataSync.get(`users/${userUid}`)
      // .then(snapData => snapData ? new User(snapData, newUid) : null)
      .then(snapData => (snapData ? new User(snapData, uid) : null))
      .catch(Log.r('User#get'));
  }
}
