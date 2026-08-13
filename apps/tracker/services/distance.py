from dataclasses import dataclass

from django.db import connection

from ..models import Facility, PostalCodeCentroid
from .business_rules import haversine_miles


@dataclass
class FacilityDistance:
    facility: Facility
    miles: float


class SQLiteDistanceRepository:
    def search(self, *, postal_code, radius, queryset=None, limit=500):
        origin = PostalCodeCentroid.objects.get(postal_code=postal_code)
        latitude, longitude = float(origin.latitude), float(origin.longitude)
        latitude_delta = radius / 69.0
        longitude_delta = radius / max(
            1, 69.0 * abs(__import__("math").cos(__import__("math").radians(latitude)))
        )
        queryset = queryset if queryset is not None else Facility.objects.filter(active=True)
        candidates = queryset.filter(
            latitude__gte=latitude - latitude_delta,
            latitude__lte=latitude + latitude_delta,
            longitude__gte=longitude - longitude_delta,
            longitude__lte=longitude + longitude_delta,
        ).order_by("name")[:limit]
        results = []
        for facility in candidates:
            miles = haversine_miles(latitude, longitude, facility.latitude, facility.longitude)
            if miles <= radius:
                results.append(FacilityDistance(facility=facility, miles=round(miles, 1)))
        return sorted(results, key=lambda result: (result.miles, result.facility.name))


class PostGISDistanceRepository:
    def search(self, *, postal_code, radius, queryset=None, limit=500):
        origin = PostalCodeCentroid.objects.get(postal_code=postal_code)
        queryset = queryset if queryset is not None else Facility.objects.filter(active=True)
        ids = list(queryset.values_list("id", flat=True)[:5000])
        if not ids:
            return []
        placeholders = ",".join(["%s"] * len(ids))
        sql = f"""
            SELECT id,
                   ST_Distance(
                       location,
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                   ) / 1609.344 AS miles
            FROM tracker_facility
            WHERE id IN ({placeholders})
              AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
            ORDER BY miles, name
            LIMIT %s
        """
        params = [
            float(origin.longitude),
            float(origin.latitude),
            *ids,
            float(origin.longitude),
            float(origin.latitude),
            radius * 1609.344,
            limit,
        ]
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
        facilities = Facility.objects.in_bulk([row[0] for row in rows])
        return [FacilityDistance(facilities[row[0]], round(float(row[1]), 1)) for row in rows]


def distance_repository():
    return PostGISDistanceRepository() if connection.vendor == "postgresql" else SQLiteDistanceRepository()
