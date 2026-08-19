from rest_framework.views import exception_handler


def first_error(value):
    if isinstance(value, dict):
        for item in value.values():
            message = first_error(item)
            if message:
                return message
    elif isinstance(value, (list, tuple)):
        for item in value:
            message = first_error(item)
            if message:
                return message
    elif value:
        return str(value)
    return None


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        detail = response.data
        message = first_error(detail) or "Une erreur est survenue."
        response.data = {
            "success": False,
            "message": message,
            "errors": detail,
        }
    return response
