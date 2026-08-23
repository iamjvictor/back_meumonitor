import type { FastifyInstance } from 'fastify';
import { TeacherRegistrationController } from '../controllers/teacher-registration.controller.js';
import { TeacherRegistrationService } from '../services/teacher-registration.service.js';
import { TeacherRepository } from '../repositories/teacher.repository.js';
import { AuthController } from '../controllers/auth.controller.js';
import { AuthRepository } from '../repositories/auth.repository.js';
import { AuthService } from '../services/auth.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { LoginController } from '../controllers/login.controller.js';
import { LoginRepository } from '../repositories/login.repository.js';
import { LoginService } from '../services/login.service.js';

export async function authRoutes(app: FastifyInstance) {
  const controller = new TeacherRegistrationController(
    new TeacherRegistrationService(new TeacherRepository()),
  );
  const authController = new AuthController(new AuthService(new AuthRepository()));
  const loginController = new LoginController(new LoginService(new LoginRepository()));

  app.post('/signup', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, authController.signup.bind(authController));
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, loginController.handle.bind(loginController));
  app.post('/register/teacher', {
    onRequest: authMiddleware,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, controller.handle.bind(controller));
}
