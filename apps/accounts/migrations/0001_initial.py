import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='UserProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('initials', models.CharField(blank=True, max_length=12, null=True, unique=True)),
                ('role', models.CharField(choices=[('administrator', 'Administrator'), ('ura_user', 'URA User'), ('report_viewer', 'Report Viewer'), ('auditor', 'Auditor')], db_index=True, default='ura_user', max_length=24)),
                ('display_name', models.CharField(blank=True, max_length=120)),
                ('activity_status', models.CharField(db_index=True, default='active', max_length=24)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='profile', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
