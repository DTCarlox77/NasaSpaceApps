'use strict';

const offlinePin = require('../services/offlinePin.service');
const authService = require('../services/auth.service');
const { validate } = require('../utils/validate');

async function login(req, res) {
  const body = validate(req.body)
    .string('username', { max: 40 })
    .string('password', { max: 200 })
    .string('device_id', { max: 100 })
    .check();
  res.json(
    await authService.login({
      username: body.username,
      password: body.password,
      deviceId: body.device_id,
      ip: req.ip,
    }),
  );
}

async function changePassword(req, res) {
  const body = validate(req.body)
    .string('current_password', { max: 200 })
    .string('new_password', { max: 200 })
    .string('device_id', { required: false, max: 100 })
    .check();
  res.json(
    await authService.changePassword({
      userId: req.auth.userId,
      currentPassword: body.current_password,
      newPassword: body.new_password,
      deviceId: body.device_id || req.auth.deviceId,
      ip: req.ip,
    }),
  );
}

async function refresh(req, res) {
  const body = validate(req.body)
    .string('refresh_token', { max: 200 })
    .string('device_id', { max: 100 })
    .check();
  res.json(
    await authService.refresh({
      refreshToken: body.refresh_token,
      deviceId: body.device_id,
      ip: req.ip,
    }),
  );
}

async function logout(req, res) {
  const body = validate(req.body)
    .string('device_id', { required: false, max: 100 })
    .boolean('all_devices')
    .check();
  await authService.logout({
    userId: req.auth.userId,
    username: req.auth.username,
    deviceId: body.device_id || req.auth.deviceId,
    allDevices: body.all_devices === true,
    ip: req.ip,
  });
  res.status(204).end();
}

async function me(req, res) {
  res.json(await authService.me(req.auth.userId));
}

async function setOfflinePin(req, res) {
  res.json(await offlinePin.setPin({ auth: req.auth, body: req.body, ip: req.ip }));
}

module.exports = { login, changePassword, refresh, logout, me, setOfflinePin };
