import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { httpStatusCode } from '../lib/constant';
import User from '../models/user/userSchema';

export const clientAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(httpStatusCode.FORBIDDEN).json({
        success: false,
        message: 'Unauthorized user: No token provided',
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(httpStatusCode.FORBIDDEN).json({
        success: false,
        message: 'Unauthorized user: No token provided',
      });
    }
    
    try {
      const decoded: any = jwt.verify(token, process.env.AUTH_SECRET || 'your-secret-key');
      
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return res.status(httpStatusCode.FORBIDDEN).json({
          success: false,
          message: 'Unauthorized user: User not found',
        });
      }
      
      if (!user.isActive) {
        return res.status(httpStatusCode.FORBIDDEN).json({
          success: false,
          message: 'Unauthorized user: User account is inactive',
        });
      }
      
      // Check if the user has the client business role
      if (user.businessRole !== 'client') {
        return res.status(httpStatusCode.FORBIDDEN).json({
          success: false,
          message: 'Unauthorized: Only clients can access this resource',
        });
      }
      
      req.user = user;
      
      next();
    } catch (tokenError) {
      return res.status(httpStatusCode.FORBIDDEN).json({
        success: false,
        message: 'Unauthorized user: Invalid token',
      });
    }
  } catch (error) {
    console.error('Client auth middleware error:', error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Server error during authentication',
    });
  }
};