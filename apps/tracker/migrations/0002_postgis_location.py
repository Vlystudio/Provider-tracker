from django.db import migrations


def add_postgis_location(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        cursor.execute(
            """
            ALTER TABLE tracker_facility
            ADD COLUMN IF NOT EXISTS location geography(Point, 4326)
            GENERATED ALWAYS AS (
                CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)::geography
                END
            ) STORED
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS tracker_facility_location_gist ON tracker_facility USING GIST (location)")


def remove_postgis_location(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP INDEX IF EXISTS tracker_facility_location_gist")
        cursor.execute("ALTER TABLE tracker_facility DROP COLUMN IF EXISTS location")


class Migration(migrations.Migration):
    dependencies = [("tracker", "0001_initial")]
    operations = [migrations.RunPython(add_postgis_location, remove_postgis_location)]
