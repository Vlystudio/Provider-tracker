from django.contrib.auth.models import Group
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import UserProfile


@receiver(post_save, sender=UserProfile)
def synchronize_role_group(sender, instance, **kwargs):
    label = dict(UserProfile.Role.choices)[instance.role]
    group, _ = Group.objects.get_or_create(name=label)
    instance.user.groups.set([group])
