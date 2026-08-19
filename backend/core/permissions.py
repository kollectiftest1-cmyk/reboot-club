from rest_framework.permissions import BasePermission

from .models import User


class IsPlatformAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and (request.user.is_superuser or request.user.role == User.Role.ADMIN))


class IsAdminOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        return request.method in ("GET", "HEAD", "OPTIONS") or bool(
            request.user.is_authenticated and (request.user.is_superuser or request.user.role == User.Role.ADMIN)
        )
