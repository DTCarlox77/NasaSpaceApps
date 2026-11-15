import { onSessionExpired } from '@/data/datasources/remote/httpClient';
import { CrewRepositoryImpl } from '@/data/repositories/CrewRepositoryImpl';
import { GetCrew, GetCrewRoster, GetCrewStatus } from '@/domain/usecases/GetCrew';
import { AuthRepositoryImpl, SessionRepositoryImpl } from '@/data/repositories/AuthRepositoryImpl';
import { EmergencyReportRepositoryImpl } from '@/data/repositories/EmergencyReportRepositoryImpl';
import { HazardRepositoryImpl } from '@/data/repositories/HazardRepositoryImpl';
import { HealthRepositoryImpl } from '@/data/repositories/HealthRepositoryImpl';
import { MissionRepositoryImpl } from '@/data/repositories/MissionRepositoryImpl';
import { ProfileRepositoryImpl } from '@/data/repositories/ProfileRepositoryImpl';
import { SyncRepositoryImpl } from '@/data/repositories/SyncRepositoryImpl';
import { WellbeingRepositoryImpl } from '@/data/repositories/WellbeingRepositoryImpl';
import {
  ChangePassword,
  GetDemoSession,
  RestoreSession,
  SetBiometricUnlock,
  SignIn,
  SignOut,
  WakeServer,
} from '@/domain/usecases/AuthUseCases';
import { GetHazards } from '@/domain/usecases/GetHazards';
import { GetHealthOverview } from '@/domain/usecases/GetHealthOverview';
import { GetMissions, GetMissionStatus } from '@/domain/usecases/GetMissionStatus';
import { GetProfilePhoto, RemoveProfilePhoto, SetProfilePhoto } from '@/domain/usecases/ProfilePhoto';
import { CloseEmergency, ConfirmOk, GetEmergencySession, SendEmergencyReport } from '@/domain/usecases/SendEmergencyReport';
import { SubmitReading } from '@/domain/usecases/SubmitReading';
import { GetPendingSync, SyncNow } from '@/domain/usecases/SyncUseCases';
import { GetInstruments, RequestSupport, SubmitCheckIn, SubmitPvtRun, SubmitScreening } from '@/domain/usecases/WellbeingUseCases';

/**
 * Composición de dependencias: el único lugar donde la presentación
 * se conecta con implementaciones concretas de la capa de datos.
 */
const hazardRepository = new HazardRepositoryImpl();
const missionRepository = new MissionRepositoryImpl();
const emergencyReportRepository = new EmergencyReportRepositoryImpl();
const authRepository = new AuthRepositoryImpl();
const sessionRepository = new SessionRepositoryImpl();
const healthRepository = new HealthRepositoryImpl();
const profileRepository = new ProfileRepositoryImpl();
const crewRepository = new CrewRepositoryImpl();
const wellbeingRepository = new WellbeingRepositoryImpl();
const syncRepository = new SyncRepositoryImpl();

export const container = {
  getHazards: new GetHazards(hazardRepository),
  getHealthOverview: new GetHealthOverview(healthRepository),
  submitReading: new SubmitReading(healthRepository),
  getMissionStatus: new GetMissionStatus(missionRepository),
  getMissions: new GetMissions(missionRepository),
  sendEmergencyReport: new SendEmergencyReport(emergencyReportRepository),
  getEmergencySession: new GetEmergencySession(emergencyReportRepository),
  confirmOk: new ConfirmOk(emergencyReportRepository),
  closeEmergency: new CloseEmergency(emergencyReportRepository),
  signIn: new SignIn(authRepository, sessionRepository),
  changePassword: new ChangePassword(authRepository, sessionRepository),
  restoreSession: new RestoreSession(sessionRepository),
  signOut: new SignOut(authRepository, sessionRepository),
  setBiometricUnlock: new SetBiometricUnlock(sessionRepository),
  getDemoSession: new GetDemoSession(authRepository),
  wakeServer: new WakeServer(authRepository),
  getProfilePhoto: new GetProfilePhoto(profileRepository),
  setProfilePhoto: new SetProfilePhoto(profileRepository),
  removeProfilePhoto: new RemoveProfilePhoto(profileRepository),
  getCrew: new GetCrew(crewRepository),
  getCrewRoster: new GetCrewRoster(crewRepository),
  getCrewStatus: new GetCrewStatus(crewRepository),
  submitCheckIn: new SubmitCheckIn(wellbeingRepository),
  requestSupport: new RequestSupport(wellbeingRepository),
  submitPvtRun: new SubmitPvtRun(wellbeingRepository),
  getInstruments: new GetInstruments(wellbeingRepository),
  submitScreening: new SubmitScreening(wellbeingRepository),
  syncNow: new SyncNow(syncRepository),
  getPendingSync: new GetPendingSync(syncRepository),
  /** Aviso de sesión vencida (refresh fallido o reuso del token): la presentación vuelve al login. */
  onSessionExpired,
};
